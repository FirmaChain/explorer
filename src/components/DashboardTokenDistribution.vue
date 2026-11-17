<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import {
  computeTokenDistribution,
  type TokenDistributionResult,
} from '@/libs/dashboardMetrics';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';

const props = defineProps<{ chain: string }>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const format = useFormatter();

const loading = ref(false);
const result = ref<TokenDistributionResult | null>(null);
const fetchError = ref('');
let generation = 0;

const bondDenom = computed(
  () =>
    stakingStore.params?.bond_denom ||
    blockchain.current?.assets?.[0]?.base ||
    ''
);

async function refresh() {
  const req = ++generation;
  fetchError.value = '';
  result.value = null;

  if (!blockchain.rpc) {
    fetchError.value = 'RPC client is unavailable.';
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    let denom = bondDenom.value;
    if (!denom) {
      const paramsRes = await blockchain.rpc.getStakingParams();
      if (req !== generation) return;
      denom = paramsRes?.params?.bond_denom || '';
    }
    if (!denom) {
      result.value = computeTokenDistribution('', undefined, undefined, undefined);
      return;
    }

    const [supplyRes, poolRes] = await Promise.all([
      blockchain.rpc.getBankSupplyByDenom(denom),
      blockchain.rpc.getStakingPool(),
    ]);
    if (req !== generation) return;

    result.value = computeTokenDistribution(
      denom,
      supplyRes?.amount?.amount,
      poolRes?.pool?.bonded_tokens,
      poolRes?.pool?.not_bonded_tokens
    );
  } catch (cause) {
    if (req !== generation) return;
    fetchError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (req === generation) loading.value = false;
  }
}

watch(
  () => [props.chain, blockchain.chainName, blockchain.endpoint.address],
  async () => {
    const reset = ++generation;
    result.value = null;
    fetchError.value = '';
    loading.value = true;
    await nextTick();
    if (reset !== generation) return;
    if (blockchain.chainName === props.chain) {
      void refresh();
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
    aria-labelledby="dashboard-token-dist-heading"
    data-dashboard-token-distribution
  >
    <h2 id="dashboard-token-dist-heading" class="text-lg font-semibold text-main">
      Token Distribution
    </h2>
    <p class="text-xs text-base-content/70 mt-1 mb-3">
      Queried asynchronously from current bank supply and staking pool endpoints (not a guaranteed single-height snapshot).
    </p>
    <p v-if="loading" role="status" class="text-sm py-2">
      Loading token distribution...
    </p>
    <div v-else-if="fetchError" role="alert" class="text-sm text-error py-2">
      Could not load token distribution: {{ fetchError }}
    </div>
    <div
      v-else-if="!result?.available"
      role="alert"
      class="text-sm text-error py-2"
    >
      Token distribution unavailable: {{ result?.reason || 'Unavailable.' }}
    </div>
    <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">
          Bonded ({{ result.bondedPercent }})
        </div>
        <div class="font-semibold tabular-nums">
          {{
            format.formatToken({
              amount: result.bonded.toString(),
              denom: result.denom,
            })
          }}
        </div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">
          Unbonding / Not Bonded ({{ result.notBondedPercent }})
        </div>
        <div class="font-semibold tabular-nums">
          {{
            format.formatToken({
              amount: result.notBonded.toString(),
              denom: result.denom,
            })
          }}
        </div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">
          Liquid / Other ({{ result.remainingPercent }})
        </div>
        <div class="font-semibold tabular-nums">
          {{
            format.formatToken({
              amount: result.remaining.toString(),
              denom: result.denom,
            })
          }}
        </div>
      </div>
    </div>
  </section>
</template>
