<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs';
import { resolveRpcEndpoint } from '@/libs/abci';
import {
  consensusStepInfo,
  fetchConsensusSnapshot,
  type ConsensusSnapshot,
} from '@/libs/dashboardMetrics';
import { useValidatorAvatars } from '@/libs/validatorAvatar';
import { useBaseStore, useBlockchain, useStakingStore } from '@/stores';

const MIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_BLOCKTIME_MS = 6000;
const MAX_BACKOFF_INTERVAL_MS = 30000;
const RING_RADIUS = 76;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const props = defineProps<{ chain: string }>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const baseStore = useBaseStore();

const { logoUrl, loadAvatar } = useValidatorAvatars(
  typeof stakingStore.keybase === 'function'
    ? (identity) => stakingStore.keybase(identity)
    : undefined
);

const loading = ref(false);
const snapshot = ref<ConsensusSnapshot | null>(null);
const error = ref('');
let watchGeneration = 0;
let requestGeneration = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let controller: AbortController | null = null;
let consecutiveErrors = 0;

const rpcEndpoint = computed(() => resolveRpcEndpoint(blockchain.current));

const validatorsWithHex = computed(() =>
  (stakingStore.validators || []).map((v) => ({
    ...v,
    consensus_hex: consensusPubkeyToHexAddress(v.consensus_pubkey),
  }))
);

const proposerValidator = computed(() => {
  const hex = normalizeConsensusHex(snapshot.value?.proposerHex);
  if (!hex) return undefined;
  return validatorsWithHex.value.find(
    (v) => normalizeConsensusHex(v.consensus_hex) === hex
  );
});

const proposerOperatorAddress = computed(
  () =>
    proposerValidator.value?.operator_address ||
    snapshot.value?.proposerOperatorAddress ||
    ''
);

const proposerIdentity = computed(
  () =>
    proposerValidator.value?.description?.identity ||
    snapshot.value?.proposerIdentity ||
    ''
);

const proposerDisplayName = computed(
  () =>
    proposerValidator.value?.description?.moniker ||
    snapshot.value?.proposerMoniker ||
    snapshot.value?.proposerHex ||
    '-'
);

const formattedHeight = computed(() => {
  const raw = snapshot.value?.height;
  if (!raw) return '-';
  if (/^\d+$/.test(raw)) {
    return new Intl.NumberFormat('en-US').format(BigInt(raw));
  }
  return raw;
});

const stepInfo = computed(() => consensusStepInfo(snapshot.value?.step));

const WRAP_FILL_MS = 220;
const WRAP_RESET_MS = 24;
const animatedPercent = ref(0);
const ringTransitionEnabled = ref(true);
let lastTargetPercent: number | null = null;
let isWrappingRing = false;
let pendingWrapTarget = 0;
let ringAnimationGen = 0;
let ringTimers: ReturnType<typeof setTimeout>[] = [];

function clearRingTimers() {
  for (const id of ringTimers) {
    clearTimeout(id);
  }
  ringTimers = [];
}

function resetRingAnimation() {
  ++ringAnimationGen;
  clearRingTimers();
  isWrappingRing = false;
  lastTargetPercent = null;
  ringTransitionEnabled.value = false;
  animatedPercent.value = 0;
}

watch(
  () =>
    snapshot.value?.available
      ? `${snapshot.value.height}/${snapshot.value.round}/${snapshot.value.step}`
      : '',
  (key) => {
    if (!key) {
      resetRingAnimation();
      return;
    }

    const nextPercent = Math.min(100, Math.max(0, stepInfo.value.percent));
    const prevPercent = lastTargetPercent;
    lastTargetPercent = nextPercent;

    if (prevPercent === null) {
      clearRingTimers();
      isWrappingRing = false;
      ringTransitionEnabled.value = true;
      animatedPercent.value = nextPercent;
      return;
    }

    if (isWrappingRing) {
      pendingWrapTarget = nextPercent;
      return;
    }

    if (nextPercent < prevPercent) {
      const gen = ++ringAnimationGen;
      clearRingTimers();
      isWrappingRing = true;
      pendingWrapTarget = nextPercent;
      ringTransitionEnabled.value = true;
      animatedPercent.value = 100;

      const t1 = setTimeout(() => {
        if (gen !== ringAnimationGen) return;
        ringTransitionEnabled.value = false;
        animatedPercent.value = 0;

        const t2 = setTimeout(() => {
          if (gen !== ringAnimationGen) return;
          isWrappingRing = false;
          ringTransitionEnabled.value = true;
          animatedPercent.value = pendingWrapTarget;
        }, WRAP_RESET_MS);
        ringTimers.push(t2);
      }, WRAP_FILL_MS);
      ringTimers.push(t1);
      return;
    }

    clearRingTimers();
    ringTransitionEnabled.value = true;
    animatedPercent.value = nextPercent;
  },
  { immediate: true, flush: 'sync' }
);

const ringDashOffset = computed(() => {
  const pct = Math.min(100, Math.max(0, animatedPercent.value));
  return RING_CIRCUMFERENCE * (1 - pct / 100);
});

watch(
  proposerIdentity,
  (identity) => {
    if (identity) loadAvatar(identity);
  },
  { immediate: true }
);

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && Boolean(document.hidden);
}

function isContextActive(): boolean {
  return blockchain.chainName === props.chain && Boolean(rpcEndpoint.value);
}

function computePollIntervalMs(): number {
  const blocktime = Number(baseStore.blocktime);
  const effectiveBlocktime =
    Number.isFinite(blocktime) && blocktime > 0
      ? blocktime
      : DEFAULT_BLOCKTIME_MS;
  const baseInterval = Math.max(
    MIN_POLL_INTERVAL_MS,
    Math.round(effectiveBlocktime / 2)
  );
  if (consecutiveErrors <= 0) return baseInterval;
  return Math.min(
    MAX_BACKOFF_INTERVAL_MS,
    baseInterval * 2 ** Math.min(consecutiveErrors, 4)
  );
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function stopPolling() {
  ++requestGeneration;
  clearTimer();
  if (controller) {
    controller.abort();
    controller = null;
  }
}

function scheduleNext(session: number) {
  clearTimer();
  if (session !== watchGeneration || !isContextActive() || isDocumentHidden()) {
    return;
  }
  timer = setTimeout(() => {
    timer = null;
    void pollOnce(session);
  }, computePollIntervalMs());
}

async function pollOnce(session = watchGeneration) {
  if (session !== watchGeneration) return;
  clearTimer();
  const req = ++requestGeneration;
  const endpoint = rpcEndpoint.value;
  if (!endpoint) {
    snapshot.value = null;
    error.value = 'No RPC endpoint is configured for this chain.';
    loading.value = false;
    return;
  }
  if (controller) controller.abort();
  const localController = new AbortController();
  controller = localController;
  if (!snapshot.value) loading.value = true;

  let shouldSchedule = false;
  try {
    const next = await fetchConsensusSnapshot(
      endpoint,
      validatorsWithHex.value,
      localController.signal
    );
    if (session !== watchGeneration || req !== requestGeneration) return;
    snapshot.value = next;
    error.value = next.error;
    consecutiveErrors = next.error ? consecutiveErrors + 1 : 0;
    shouldSchedule = true;
  } catch (cause: any) {
    if (
      session !== watchGeneration ||
      req !== requestGeneration ||
      cause?.name === 'AbortError'
    ) {
      return;
    }
    snapshot.value = null;
    error.value = cause instanceof Error ? cause.message : String(cause);
    consecutiveErrors += 1;
    shouldSchedule = true;
  } finally {
    if (controller === localController) {
      controller = null;
    }
    if (session === watchGeneration && req === requestGeneration) {
      loading.value = false;
      if (shouldSchedule) {
        scheduleNext(session);
      }
    }
  }
}

function handleRetry() {
  consecutiveErrors = 0;
  void pollOnce(watchGeneration);
}

function handleVisibilityChange() {
  if (isDocumentHidden()) {
    stopPolling();
  } else if (isContextActive()) {
    consecutiveErrors = 0;
    void pollOnce(watchGeneration);
  }
}

if (
  typeof document !== 'undefined' &&
  typeof document.addEventListener === 'function'
) {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

watch(
  () => [props.chain, blockchain.chainName, rpcEndpoint.value],
  async () => {
    stopPolling();
    const session = ++watchGeneration;
    consecutiveErrors = 0;
    snapshot.value = null;
    error.value = '';
    loading.value = true;
    await nextTick();
    if (session !== watchGeneration) return;
    if (blockchain.chainName === props.chain) {
      if (isDocumentHidden()) {
        if (!rpcEndpoint.value) {
          error.value = 'No RPC endpoint is configured for this chain.';
        }
        loading.value = false;
        return;
      }
      await pollOnce(session);
    }
  },
  { immediate: true, flush: 'sync' }
);

onScopeDispose(() => {
  ++watchGeneration;
  stopPolling();
  resetRingAnimation();
  if (
    typeof document !== 'undefined' &&
    typeof document.removeEventListener === 'function'
  ) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
});
</script>

<template>
  <section
    class="bg-base-100 rounded shadow p-4 h-full flex flex-col"
    aria-labelledby="dashboard-consensus-heading"
    data-dashboard-consensus
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
      <h2 id="dashboard-consensus-heading" class="text-lg font-semibold text-main">
        Consensus State
      </h2>
      <RouterLink
        :to="`/${chain}/consensus`"
        class="text-sm link link-primary no-underline"
      >
        Details
      </RouterLink>
    </div>
    <p class="text-xs text-base-content/70 mb-4">
      Observed via periodic RPC polling (events between polls are not captured).
    </p>
    <p v-if="loading" role="status" class="text-sm py-2">
      Loading consensus state...
    </p>
    <div v-else-if="error" role="alert" class="text-sm text-error py-2">
      Consensus state unavailable: {{ error }}
      <button type="button" class="btn btn-xs ml-2" @click="handleRetry">
        Retry
      </button>
    </div>
    <div
      v-else-if="snapshot?.available"
      class="flex-1 flex flex-col justify-between gap-4"
    >
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div class="text-xs text-base-content/70 mb-1">Height</div>
          <div class="text-lg font-semibold text-main tabular-nums">
            {{ formattedHeight }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-base-content/70 mb-1">Proposer</div>
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="avatar w-6 h-6 rounded-full shrink-0 overflow-hidden bg-base-200 flex items-center justify-center"
            >
              <img
                v-if="logoUrl(proposerIdentity)"
                :src="logoUrl(proposerIdentity)"
                :alt="proposerDisplayName"
                class="w-6 h-6 object-cover rounded-full"
              />
              <svg
                v-else
                class="w-4 h-4 text-base-content/60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M5 20a7 7 0 0 1 14 0" />
              </svg>
            </span>
            <RouterLink
              v-if="proposerOperatorAddress"
              :to="`/${chain}/staking/${proposerOperatorAddress}`"
              class="truncate text-primary hover:underline underline-offset-4 font-medium"
            >
              {{ proposerDisplayName }}
            </RouterLink>
            <span v-else class="truncate font-semibold text-main">
              {{ proposerDisplayName }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex-1 flex items-center justify-center py-2">
        <div class="relative inline-flex items-center justify-center w-[180px] h-[180px]">
          <svg
            class="w-full h-full"
            viewBox="0 0 180 180"
            role="img"
            :aria-label="`Step ${snapshot.step}${stepInfo.name ? ` (${stepInfo.name})` : ''}, Round ${snapshot.round}`"
          >
            <circle
              cx="90"
              cy="90"
              :r="RING_RADIUS"
              fill="none"
              stroke="currentColor"
              stroke-width="10"
              class="text-primary/20"
            />
            <circle
              cx="90"
              cy="90"
              :r="RING_RADIUS"
              fill="none"
              stroke="currentColor"
              stroke-width="10"
              stroke-linecap="round"
              class="text-primary"
              transform="rotate(-90 90 90)"
              :stroke-dasharray="RING_CIRCUMFERENCE"
              :stroke-dashoffset="ringDashOffset"
              :stroke-opacity="animatedPercent > 0 ? 1 : 0"
              :style="{
                transition: ringTransitionEnabled
                  ? 'stroke-dashoffset 220ms ease-out, stroke-opacity 120ms linear'
                  : 'none',
              }"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <div class="text-2xl font-bold text-main tabular-nums">
              Step {{ snapshot.step }}
            </div>
            <div v-if="stepInfo.name" class="text-xs font-medium text-primary mt-0.5">
              {{ stepInfo.name }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
