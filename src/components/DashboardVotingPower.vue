<script setup lang="ts">
import { nextTick, onScopeDispose, ref, watch } from 'vue';
import {
  computeOnlineVotingPower,
  type OnlineVotingPowerResult,
} from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useStakingStore } from '@/stores';

const props = defineProps<{ chain: string }>();

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const stakingStore = useStakingStore();

const loading = ref(false);
const result = ref<OnlineVotingPowerResult | null>(null);
let generation = 0;
let lastContextKey = '';

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

  const commitHeight = baseStore.latest?.block?.last_commit?.height;
  if (!commitHeight) {
    if (!result.value) {
      loading.value = true;
    }
    return;
  }

  if (showInitialLoading || !result.value) {
    loading.value = true;
  }
  try {
    const computedPower = await computeOnlineVotingPower(
      blockchain.rpc,
      baseStore.latest,
      stakingStore.validators
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

onScopeDispose(() => {
  ++generation;
});
</script>

<template>
  <section
    class="bg-base-100 rounded mt-4 shadow p-4"
    aria-labelledby="dashboard-voting-power-heading"
    data-dashboard-voting-power
  >
    <h2 id="dashboard-voting-power-heading" class="text-lg font-semibold text-main">
      Online Voting Power
    </h2>
    <p class="text-xs text-base-content/70 mt-1 mb-3">
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
    <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">
          Signed Online Power (height #{{ result.height }})
        </div>
        <div class="font-semibold tabular-nums">
          {{ result.signedPercent }}
        </div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Power Numerator / Denominator</div>
        <div class="font-semibold tabular-nums">
          {{ result.signedPower.toString() }} / {{ result.totalPower.toString() }}
        </div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Signing Validators</div>
        <div class="font-semibold tabular-nums">
          {{ result.signedValidators }} / {{ result.totalValidators }}
        </div>
      </div>
    </div>
  </section>
</template>
