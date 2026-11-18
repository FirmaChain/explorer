<!-- Modified by FirmaChain (2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script setup lang="ts">
import { computed, ref, type PropType } from 'vue';
import { useFormatter } from '@/stores';
import type { CommissionRate } from '@/types';

const props = defineProps({
  commission: { type: Object as PropType<CommissionRate> },
});

const hoveredIndex = ref<number | null>(null);
const selectedIndex = ref<number | null>(null);

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

// Match ApexCharts sizing inside .w-80 (320px x 237px, customScale: 0.9, donut.size: 83%)
const VIEW_W = 320;
const VIEW_H = 237;
const CX = 160;
const CY = 122;
const OUTER_R = 101;
const INNER_R = 84;
const EXPAND_OFFSET = 9;
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

function describeDonutSector(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(cx, cy, outerR, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, clampedEnd);
  const innerEnd = polarToCartesian(cx, cy, innerR, clampedEnd);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

interface GaugeSegment {
  index: number;
  key: string;
  label: string;
  color: string;
  d: string;
  expandTransform: string;
}

const gaugeSegments = computed<GaugeSegment[]>(() => {
  const values = series.value.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((acc, v) => acc + v, 0);
  if (total <= 0) {
    return [
      {
        index: 0,
        key: 'empty',
        label: 'Available',
        color: COLORS[0],
        d: describeDonutSector(CX, CY, OUTER_R, INNER_R, START_ANGLE, END_ANGLE),
        expandTransform: '',
      },
    ];
  }

  let cursor = START_ANGLE;
  const result: GaugeSegment[] = [];

  values.forEach((val, idx) => {
    if (val <= 0) return;
    const sweep = (val / total) * TOTAL_SWEEP;
    const segStart = cursor;
    const segEnd = cursor + sweep;
    cursor = segEnd;
    if (segEnd - segStart > 0.1) {
      const midRad = (((segStart + segEnd) / 2 - 90) * Math.PI) / 180;
      const dx = (EXPAND_OFFSET * Math.cos(midRad)).toFixed(2);
      const dy = (EXPAND_OFFSET * Math.sin(midRad)).toFixed(2);
      result.push({
        index: idx,
        key: `seg-${idx}`,
        label: LABELS[idx],
        color: COLORS[idx],
        d: describeDonutSector(CX, CY, OUTER_R, INNER_R, segStart, segEnd),
        expandTransform: `translate(${dx} ${dy})`,
      });
    }
  });

  return result;
});

function toggleSlice(index: number) {
  selectedIndex.value = selectedIndex.value === index ? null : index;
}

const centerLabel = computed(() => {
  const activeIdx = hoveredIndex.value ?? selectedIndex.value;
  if (activeIdx === null) return 'Commission Rate';
  return gaugeSegments.value.find((s) => s.index === activeIdx)?.label ?? 'Commission Rate';
});
</script>

<template>
  <div class="bg-base-100 rounded shadow p-4">
    <div class="text-lg text-main font-semibold mb-1">Commission Rate</div>
    <div class="text-sm text-base-content/70">
      {{ `Updated at ${format.toDay(props.commission?.update_time, 'short')}` }}
    </div>
    <div class="w-80 max-w-full m-auto">
      <svg
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        class="w-full h-[237px] overflow-visible select-none"
        role="img"
        :aria-label="`Commission Rate ${rate.toFixed(1)}%`"
      >
        <g>
          <path
            v-for="seg in gaugeSegments"
            :key="seg.key"
            :d="seg.d"
            :fill="seg.color"
            stroke="hsl(var(--b1))"
            stroke-width="2.7"
            stroke-linejoin="round"
            :transform="selectedIndex === seg.index ? seg.expandTransform : undefined"
            class="transition-transform duration-200"
            @mouseenter="hoveredIndex = seg.index"
            @mouseleave="hoveredIndex = null"
            @click="toggleSlice(seg.index)"
          />
        </g>
        <text
          :x="CX"
          :y="CY + 1"
          text-anchor="middle"
          dominant-baseline="middle"
          class="font-medium pointer-events-none"
          fill="hsl(var(--bc))"
          style="font-size: 30.6px"
        >
          {{ `${rate.toFixed(1)}%` }}
        </text>
        <text
          :x="CX"
          :y="CY + 25"
          text-anchor="middle"
          dominant-baseline="middle"
          class="pointer-events-none"
          fill="hsl(var(--bc))"
          style="font-size: 14.4px"
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
