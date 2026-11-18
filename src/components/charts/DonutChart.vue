<!-- Modified by FirmaChain (2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, ref } from 'vue';
import { donutColors } from './chartConfig';

const props = defineProps<{
  series?: Array<number | string>;
  labels?: Array<string | undefined>;
  height?: number | string;
}>();

const hoveredIndex = ref<number | null>(null);

const CX = 110;
const CY = 110;
const OUTER_R = 88;
const INNER_R = 57;
const LABEL_R = (OUTER_R + INNER_R) / 2;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeDonutSlice(
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

interface SliceItem {
  index: number;
  label: string;
  value: number;
  percent: number;
  color: string;
  d: string;
  labelPos: { x: number; y: number } | null;
}

const slices = computed<SliceItem[]>(() => {
  const rawSeries = Array.isArray(props.series) ? props.series : [];
  const rawLabels = Array.isArray(props.labels) ? props.labels : [];
  const values = rawSeries.map((v) => Math.max(0, Number(v) || 0));
  const total = values.reduce((acc, v) => acc + v, 0);

  let cursor = 0;
  return values.map((value, index) => {
    const label = rawLabels[index] ?? `Series ${index + 1}`;
    const color = donutColors[index % donutColors.length];
    if (total <= 0 || value <= 0) {
      return {
        index,
        label,
        value,
        percent: 0,
        color,
        d: '',
        labelPos: null,
      };
    }

    const ratio = value / total;
    const sweep = ratio * 360;
    const startAngle = cursor;
    const endAngle = cursor + sweep;
    cursor = endAngle;

    const midAngle = startAngle + sweep / 2;
    const percent = Math.round(ratio * 100);
    const labelPos = ratio >= 0.06 ? polarToCartesian(CX, CY, LABEL_R, midAngle) : null;

    return {
      index,
      label,
      value,
      percent,
      color,
      d: describeDonutSlice(CX, CY, OUTER_R, INNER_R, startAngle, endAngle),
      labelPos,
    };
  });
});

const hasPositiveData = computed(() => slices.value.some((s) => s.value > 0));

const activeSlice = computed(() => {
  if (hoveredIndex.value !== null) {
    return slices.value[hoveredIndex.value] ?? null;
  }
  return slices.value.find((s) => s.value > 0) ?? null;
});
</script>

<template>
  <div class="flex flex-col items-center justify-center w-full py-2 select-none">
    <svg
      viewBox="0 0 220 220"
      class="w-full max-w-[230px] overflow-visible"
      role="img"
      aria-label="Donut chart"
    >
      <circle
        v-if="!hasPositiveData"
        :cx="CX"
        :cy="CY"
        :r="LABEL_R"
        fill="none"
        stroke="currentColor"
        :stroke-width="OUTER_R - INNER_R"
        class="text-base-200"
      />
      <g v-else>
        <path
          v-for="slice in slices"
          v-show="Boolean(slice.d)"
          :key="slice.index"
          :d="slice.d"
          :fill="slice.color"
          :opacity="hoveredIndex !== null && hoveredIndex !== slice.index ? 0.55 : 1"
          class="transition-opacity duration-150 cursor-pointer"
          @mouseenter="hoveredIndex = slice.index"
          @mouseleave="hoveredIndex = null"
        >
          <title>{{ `${slice.label}: ${Math.floor(slice.value)} (${slice.percent}%)` }}</title>
        </path>
        <text
          v-for="slice in slices"
          v-show="slice.labelPos"
          :key="`lbl-${slice.index}`"
          :x="slice.labelPos?.x"
          :y="slice.labelPos?.y"
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-white text-[11px] font-semibold pointer-events-none"
          style="text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55)"
        >
          {{ `${slice.percent}%` }}
        </text>
      </g>

      <g v-if="activeSlice && hasPositiveData" class="pointer-events-none">
        <text
          :x="CX"
          :y="CY - 10"
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-base-content font-semibold"
          style="font-size: 16px"
        >
          {{ activeSlice.label }}
        </text>
        <text
          :x="CX"
          :y="CY + 14"
          text-anchor="middle"
          dominant-baseline="middle"
          class="fill-base-content/70"
          style="font-size: 16px"
        >
          {{ Math.floor(activeSlice.value) }}
        </text>
      </g>
    </svg>

    <div
      v-if="slices.length > 0"
      class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-3 px-2 text-xs"
    >
      <div
        v-for="slice in slices"
        :key="`legend-${slice.index}`"
        class="flex items-center gap-1.5 cursor-pointer transition-opacity"
        :class="{ 'opacity-50': hoveredIndex !== null && hoveredIndex !== slice.index }"
        @mouseenter="hoveredIndex = slice.index"
        @mouseleave="hoveredIndex = null"
      >
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: slice.color }"
        ></span>
        <span class="text-base-content/75">{{ slice.label }}</span>
      </div>
    </div>
  </div>
</template>
