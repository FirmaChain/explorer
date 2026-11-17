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
const hoveredKey = ref<string | null>(null);
let generation = 0;

const CHART_CX = 110;
const CHART_CY = 104;
const CHART_RADIUS = 76;

interface DistributionSegment {
  key: 'bonded' | 'remaining' | 'notBonded';
  label: string;
  amount: bigint;
  percent: string;
  formattedAmount: string;
  color: string;
  path: string;
}

function buildSemiCircleArcPath(thetaStart: number, thetaEnd: number): string {
  const x1 = CHART_CX + CHART_RADIUS * Math.cos(thetaStart);
  const y1 = CHART_CY - CHART_RADIUS * Math.sin(thetaStart);
  const x2 = CHART_CX + CHART_RADIUS * Math.cos(thetaEnd);
  const y2 = CHART_CY - CHART_RADIUS * Math.sin(thetaEnd);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${CHART_RADIUS} ${CHART_RADIUS} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const segments = computed<DistributionSegment[]>(() => {
  const res = result.value;
  if (!res?.available || res.totalSupply <= 0n) return [];

  const rawItems: Array<{
    key: 'bonded' | 'remaining' | 'notBonded';
    label: string;
    amount: bigint;
    percent: string;
    color: string;
  }> = [
    {
      key: 'bonded',
      label: 'Bonded',
      amount: res.bonded,
      percent: res.bondedPercent,
      color: '#009FFA',
    },
    {
      key: 'remaining',
      label: 'Liquid / Other',
      amount: res.remaining,
      percent: res.remainingPercent,
      color: '#F60239',
    },
    {
      key: 'notBonded',
      label: 'Unbonding / Not Bonded',
      amount: res.notBonded,
      percent: res.notBondedPercent,
      color: '#a855f7',
    },
  ];

  const nonZeroIndices = rawItems
    .map((item, idx) => (item.amount > 0n ? idx : -1))
    .filter((idx) => idx >= 0);
  const lastNonZeroIdx = nonZeroIndices[nonZeroIndices.length - 1] ?? -1;

  let currentTheta = Math.PI;
  return rawItems.map((item, idx) => {
    let path = '';
    if (item.amount > 0n) {
      const thetaStart = currentTheta;
      const ratio =
        Number((item.amount * 1_000_000n) / res.totalSupply) / 1_000_000;
      const thetaEnd =
        idx === lastNonZeroIdx ? 0 : Math.max(0, thetaStart - ratio * Math.PI);
      path = buildSemiCircleArcPath(thetaStart, thetaEnd);
      currentTheta = thetaEnd;
    }

    return {
      ...item,
      formattedAmount: format.formatToken({
        amount: item.amount.toString(),
        denom: res.denom,
      }),
      path,
    };
  });
});

const summaryHighlights = computed(() => segments.value.slice(0, 2));

const totalSupplyFormatted = computed(() => {
  if (!result.value?.available) return '';
  return format.formatToken({
    amount: result.value.totalSupply.toString(),
    denom: result.value.denom,
  });
});

const activeSegment = computed(() =>
  hoveredKey.value
    ? segments.value.find((seg) => seg.key === hoveredKey.value) ?? null
    : null
);

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
    class="bg-base-100 rounded shadow p-4 h-full flex flex-col"
    aria-labelledby="dashboard-token-dist-heading"
    data-dashboard-token-distribution
  >
    <h2 id="dashboard-token-dist-heading" class="text-lg font-semibold text-main">
      Token Distribution
    </h2>
    <p class="text-xs text-base-content/70 mt-1 mb-4">
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
    <div v-else class="flex-1 flex flex-col justify-between gap-3">
      <div class="grid grid-cols-2 gap-3">
        <div
          v-for="item in summaryHighlights"
          :key="item.key"
          class="min-w-0"
        >
          <div class="text-base sm:text-lg font-semibold text-main tabular-nums truncate">
            {{ item.formattedAmount }}
          </div>
          <div class="text-xs text-base-content/70">
            {{ item.label }} ({{ item.percent }})
          </div>
        </div>
      </div>

      <div class="relative flex flex-col items-center justify-center my-1">
        <svg
          class="w-full max-w-[230px] overflow-visible"
          viewBox="0 0 220 120"
          role="img"
          aria-label="Token distribution chart"
        >
          <path
            :d="buildSemiCircleArcPath(Math.PI, 0)"
            fill="none"
            stroke="currentColor"
            stroke-width="26"
            class="text-base-200"
          />
          <path
            v-for="seg in segments"
            v-show="Boolean(seg.path)"
            :key="seg.key"
            :d="seg.path"
            fill="none"
            :stroke="seg.color"
            :stroke-width="hoveredKey === seg.key ? 29 : 26"
            :opacity="hoveredKey && hoveredKey !== seg.key ? 0.4 : 1"
            class="transition-all duration-200 cursor-pointer"
            @mouseenter="hoveredKey = seg.key"
            @mouseleave="hoveredKey = null"
          />
        </svg>
        <div class="text-center -mt-6 pointer-events-none">
          <template v-if="activeSegment">
            <div class="text-xs text-base-content/70">{{ activeSegment.label }}</div>
            <div class="text-sm font-bold text-main tabular-nums">
              {{ activeSegment.percent }}
            </div>
          </template>
          <template v-else>
            <div class="text-xs text-base-content/70">Total Supply</div>
            <div class="text-sm font-semibold text-main tabular-nums">
              {{ totalSupplyFormatted }}
            </div>
          </template>
        </div>
      </div>

      <div class="pt-3 border-t border-base-200 space-y-2 text-sm">
        <div
          v-for="seg in segments"
          :key="seg.key"
          class="flex items-center justify-between gap-2 rounded px-1 py-0.5 transition-colors"
          :class="{ 'bg-base-200/70': hoveredKey === seg.key }"
          @mouseenter="hoveredKey = seg.key"
          @mouseleave="hoveredKey = null"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="w-3 h-3 rounded-sm shrink-0"
              :style="{ backgroundColor: seg.color }"
              aria-hidden="true"
            ></span>
            <span class="text-base-content/80 truncate">
              {{ seg.label }} ({{ seg.percent }})
            </span>
          </div>
          <span class="font-semibold text-main tabular-nums shrink-0">
            {{ seg.formattedAmount }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
