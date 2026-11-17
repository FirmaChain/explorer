<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import {
  computeBigIntRatioPercent,
  computeOnlineVotingPower,
  formatBigIntInteger,
  type CachedValidatorSet,
  type OnlineVotingPowerResult,
} from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useStakingStore } from '@/stores';

const props = defineProps<{ chain: string }>();

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const stakingStore = useStakingStore();

const loading = ref(false);
const result = ref<OnlineVotingPowerResult | null>(null);
const validatorSetCache: { current: CachedValidatorSet | null } = { current: null };
let generation = 0;
let lastContextKey = '';
let initialFetchTried = false;

async function refresh(showInitialLoading: boolean) {
  const req = ++generation;
  if (!blockchain.rpc) {
    result.value = {
      available: false,
      height: '',
      signedPower: 0n,
      totalPower: 0n,
      signedPercent: '-',
      signedValidators: 0,
      totalValidators: 0,
      reason: 'RPC client is unavailable.',
    };
    loading.value = false;
    return;
  }

  let latestBlock = baseStore.latest;
  let commitHeight = latestBlock?.block?.last_commit?.height;
  const canFetchLatest = typeof (blockchain.rpc as any).getBaseBlockLatest === 'function';

  if (!commitHeight && (!canFetchLatest || initialFetchTried)) {
    if (!result.value && !canFetchLatest) {
      loading.value = true;
    }
    return;
  }

  if (
    commitHeight &&
    result.value?.available &&
    result.value.height === String(commitHeight)
  ) {
    loading.value = false;
    return;
  }

  if (showInitialLoading || !result.value) {
    loading.value = true;
  }
  try {
    if (!commitHeight && canFetchLatest) {
      initialFetchTried = true;
      latestBlock = await (blockchain.rpc as any).getBaseBlockLatest();
      if (req !== generation) return;
      commitHeight = latestBlock?.block?.last_commit?.height;
      if (
        commitHeight &&
        result.value?.available &&
        result.value.height === String(commitHeight)
      ) {
        return;
      }
    }

    const computedPower = await computeOnlineVotingPower(
      blockchain.rpc,
      latestBlock,
      stakingStore.validators,
      { cache: validatorSetCache }
    );
    if (req !== generation) return;
    result.value = computedPower;
  } catch (cause) {
    if (req !== generation) return;
    result.value = {
      available: false,
      height: '',
      signedPower: 0n,
      totalPower: 0n,
      signedPercent: '-',
      signedValidators: 0,
      totalValidators: 0,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    if (req === generation) loading.value = false;
  }
}

watch(
  () => [
    props.chain,
    blockchain.chainName,
    blockchain.endpoint.address,
    baseStore.latest?.block?.last_commit?.height,
  ],
  async ([propChain, storeChain, endpointAddr]) => {
    const nextContextKey = `${propChain || ''}|${storeChain || ''}|${endpointAddr || ''}`;
    const contextChanged = nextContextKey !== lastContextKey;
    lastContextKey = nextContextKey;

    const reset = ++generation;
    if (contextChanged) {
      validatorSetCache.current = null;
      initialFetchTried = false;
      result.value = null;
      loading.value = true;
    }
    await nextTick();
    if (reset !== generation) return;
    if (blockchain.chainName === props.chain) {
      void refresh(contextChanged);
    }
  },
  { immediate: true, flush: 'sync' }
);

const progressPercent = computed(() => {
  if (!result.value?.available) return 0;
  return computeBigIntRatioPercent(
    result.value.signedPower,
    result.value.totalPower
  );
});

const summaryRows = computed(() => {
  if (!result.value?.available) return [];
  return [
    {
      label: 'Signing Validators',
      value: `${result.value.signedValidators} / ${result.value.totalValidators}`,
    },
    {
      label: 'Voting Power %',
      value: result.value.signedPercent,
    },
    {
      label: 'Voting Power',
      value: formatBigIntInteger(result.value.signedPower),
    },
    {
      label: 'Total Voting Power',
      value: formatBigIntInteger(result.value.totalPower),
    },
  ];
});

onScopeDispose(() => {
  ++generation;
});
</script>

<template>
  <section
    class="bg-base-100 rounded shadow p-4 h-full flex flex-col"
    aria-labelledby="dashboard-voting-power-heading"
    data-dashboard-voting-power
  >
    <h2 id="dashboard-voting-power-heading" class="text-lg font-semibold text-main mb-1">
      Online Voting Power
    </h2>
    <p class="text-xs text-base-content/70 mb-4">
      Commit-signed consensus voting power measured at the latest committed block height.
    </p>
    <p v-if="loading" role="status" class="text-sm py-2">
      Loading online voting power...
    </p>
    <div
      v-else-if="!result?.available"
      role="alert"
      class="text-sm text-error py-2"
    >
      Online voting power unavailable: {{ result?.reason || 'Not ready.' }}
    </div>
    <div v-else class="flex-1 flex flex-col">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="text-3xl font-bold text-primary tabular-nums">
          {{ result.signedPercent }}
        </span>
        <span class="text-sm text-base-content/70 tabular-nums">
          {{ formatBigIntInteger(result.signedPower) }} /
          {{ formatBigIntInteger(result.totalPower) }}
        </span>
      </div>

      <div
        class="w-full h-3 rounded-full bg-primary/20 overflow-hidden my-4"
        role="progressbar"
        aria-label="Online voting power percentage"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full bg-primary transition-all duration-300"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>

      <div class="mt-auto pt-3 border-t border-base-200 space-y-2.5 text-sm">
        <div
          v-for="row in summaryRows"
          :key="row.label"
          class="flex items-center justify-between gap-2"
        >
          <span class="text-base-content/70">{{ row.label }}</span>
          <span class="font-semibold text-main tabular-nums">{{ row.value }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
