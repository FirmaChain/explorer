<!-- Modified by FirmaChain (2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script setup lang="ts">
import { computed, ref, type PropType } from 'vue';
import { useFormatter } from '@/stores';
import type { CommissionRate } from '@/types';

const props = defineProps({
  commission: { type: Object as PropType<CommissionRate> },
});

const hoveredLabel = ref<string | null>(null);

const rate = computed(() => Number(props.commission?.commission_rates.rate || 0) * 100);
const change = computed(() => Number(props.commission?.commission_rates.max_change_rate || 0) * 100);
const max = computed(() => Number(props.commission?.commission_rates.max_rate || 1) * 100);

const left = rate;
const right = computed(() => Math.max(0, max.value - rate.value));

const s1 = computed(() => (left.value > change.value ? left.value - change.value : 0));
const s2 = computed(() => (left.value > change.value ? change.value : left.value));
const s3 = 2;
const s4 = computed(() => (right.value > change.value ? change.value : right.value));
const s5 = computed(() => (right.value > change.value ? right.value - change.value : 0));

const series = computed(() => [s1.value, s2.value, s3, s4.value, s5.value]);

const format = useFormatter();

const COLORS = [
  'rgba(109,120,141,0.2)',
  'rgba(114,225,40,0.2)',
  'rgba(114,225,40,1)',
  'rgba(114,225,40,0.2)',
  'rgba(109,120,141,0.2)',
];

const LABELS = ['Available', 'Daily Change', 'Commission Rate', 'Daily Change', 'Available'];

const CX = 120;
const CY = 115;
const RADIUS = 82;
const START_ANGLE = -130;
const END_ANGLE = 130;
const TOTAL_SWEEP = END_ANGLE - START_ANGLE;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, clampedEnd);
  const largeArcFlag = clampedEnd - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const gaugeSegments = computed(() => {
  const values = series.value.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((acc, v) => acc + v, 0);
  if (total <= 0) {
    return [
      {
        key: 'empty',
        label: 'Available',
        color: COLORS[0],
        d: describeArc(CX, CY, RADIUS, START_ANGLE, END_ANGLE),
      },
    ];
  }

  let cursor = START_ANGLE;
  const result: Array<{ key: string; label: string; color: string; d: string }> = [];
  const activeCount = values.filter((v) => v > 0).length;
  const gapDeg = activeCount > 1 ? 1.5 : 0;

  values.forEach((val, idx) => {
    if (val <= 0) return;
    const sweep = (val / total) * TOTAL_SWEEP;
    const halfGap = sweep > gapDeg * 2 ? gapDeg / 2 : 0;
    const segStart = cursor + halfGap;
    const segEnd = cursor + sweep - halfGap;
    cursor += sweep;
    if (segEnd - segStart > 0.1) {
      result.push({
        key: `seg-${idx}`,
        label: LABELS[idx],
        color: COLORS[idx],
        d: describeArc(CX, CY, RADIUS, segStart, segEnd),
      });
    }
  });

  return result;
});

const centerLabel = computed(() => hoveredLabel.value ?? 'Commission Rate');
</script>

<template>
  <div class="bg-base-100 rounded shadow p-4">
    <div class="text-lg text-main font-semibold mb-1">Commission Rate</div>
    <div class="text-sm text-base-content/70">
      {{ `Updated at ${format.toDay(props.commission?.update_time, 'short')}` }}
    </div>
    <div class="w-80 max-w-full m-auto flex justify-center py-2">
      <svg
        viewBox="0 0 240 200"
        class="w-[220px] h-[185px] overflow-visible"
        role="img"
        :aria-label="`Commission Rate ${rate.toFixed(1)}%`"
      >
        <g fill="none" stroke-width="16" stroke-linecap="butt">
          <path
            v-for="seg in gaugeSegments"
            :key="seg.key"
            :d="seg.d"
            :stroke="seg.color"
            class="cursor-pointer"
            @mouseenter="hoveredLabel = seg.label"
            @mouseleave="hoveredLabel = null"
          />
        </g>
        <text
          :x="CX"
          :y="CY - 4"
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-base-content font-medium pointer-events-none"
          style="font-size: 32px"
        >
          {{ `${rate.toFixed(1)}%` }}
        </text>
        <text
          :x="CX"
          :y="CY + 28"
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-base-content/80 pointer-events-none"
          style="font-size: 15px"
        >
          {{ centerLabel }}
        </text>
      </svg>
    </div>
    <div>
      <div class="flex items-center justify-center flex-wrap gap-x-3">
        <div class="flex items-center gap-x-2">
          <div class="bg-success w-[6px] h-[6px] rounded-full"></div>
          <span class="text-caption">Rate:{{ rate.toFixed(0) }}%</span>
        </div>
        <div class="flex items-center gap-x-2">
          <div class="bg-success w-[6px] h-[6px] rounded-full opacity-60"></div>
          <span class="text-caption">24h: ±{{ change }}%</span>
        </div>
        <div class="flex items-center gap-x-2">
          <div class="bg-secondary w-[6px] h-[6px] rounded-full"></div>
          <span class="text-caption">Max:{{ max }}%</span>
        </div>
      </div>
    </div>
  </div>
</template>
