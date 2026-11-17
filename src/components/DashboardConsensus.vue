<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { consensusPubkeyToHexAddress } from '@/libs';
import { resolveRpcEndpoint } from '@/libs/abci';
import {
  fetchConsensusSnapshot,
  type ConsensusSnapshot,
} from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useStakingStore } from '@/stores';

const MIN_POLL_INTERVAL_MS = 2000;
const DEFAULT_BLOCKTIME_MS = 6000;
const MAX_BACKOFF_INTERVAL_MS = 30000;

const props = defineProps<{ chain: string }>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const baseStore = useBaseStore();

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
    class="bg-base-100 rounded mt-4 shadow p-4"
    aria-labelledby="dashboard-consensus-heading"
    data-dashboard-consensus
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
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
    <p class="text-xs text-base-content/70 mb-3">
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
      class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"
    >
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Height</div>
        <div class="font-semibold tabular-nums">{{ snapshot.height }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Round</div>
        <div class="font-semibold tabular-nums">{{ snapshot.round }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Step</div>
        <div class="font-semibold tabular-nums">{{ snapshot.step }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Proposer</div>
        <div class="font-semibold truncate">
          {{ snapshot.proposerMoniker || snapshot.proposerHex || '-' }}
        </div>
      </div>
    </div>
  </section>
</template>
