<!-- Copyright (c) 2026 FirmaChain | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import dayjs from 'dayjs';
import numeral from 'numeral';
import { useBaseStore } from '@/stores';
import { colorVariables, getPrimaryChartColor } from './chartConfig';

export interface AreaSeries {
  name: string;
  data: number[];
}

const props = withDefaults(
  defineProps<{
    series?: AreaSeries[];
    categories?: Array<number | string>;
    height?: number | string;
  }>(),
  {
    series: () => [],
    categories: () => [],
    height: 230,
  }
);

const baseStore = useBaseStore();
const gradientId = `area-grad-${Math.random().toString(36).slice(2, 9)}`;
const hoveredIndex = ref<number | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const viewW = ref(680);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (containerRef.value) {
    const initialW = containerRef.value.clientWidth;
    if (initialW > 120) viewW.value = initialW;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (w && w > 120) {
          viewW.value = Math.round(w);
        }
      });
      resizeObserver.observe(containerRef.value);
    }
  }
});

onScopeDispose(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

const VIEW_H = computed(() => {
  const parsed = Number(props.height);
  return Number.isFinite(parsed) && parsed >= 140 ? parsed : 230;
});

const PAD_LEFT = 54;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

const plotW = computed(() => Math.max(60, viewW.value - PAD_LEFT - PAD_RIGHT));
const plotH = computed(() => VIEW_H.value - PAD_TOP - PAD_BOTTOM);

const primaryColor = computed(() => getPrimaryChartColor());
const palette = computed(() => colorVariables(baseStore.theme));

const activeSeries = computed(() => props.series?.[0] ?? { name: '', data: [] });

const rawPoints = computed(() => {
  const data = Array.isArray(activeSeries.value?.data) ? activeSeries.value.data : [];
  return data.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
});

const yBounds = computed(() => {
  const pts = rawPoints.value;
  if (pts.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...pts);
  let max = Math.max(...pts);
  if (min === max) {
    const delta = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= delta;
    max += delta;
  } else {
    const pad = (max - min) * 0.06;
    min = Math.max(0, min - pad);
    max = max + pad;
  }
  return { min, max };
});

function formatYValue(value: number): string {
  const pattern = Math.abs(Number(value)) > 0.01 ? '0.0[0]a' : '0.00[000]';
  return numeral(value).format(pattern);
}

function formatXLabel(raw: number | string | undefined, detailed = false): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const d = dayjs(raw);
  if (!d.isValid()) return String(raw);
  return detailed ? d.format('MMM D, YYYY HH:mm') : d.format('MMM D');
}

const yTicks = computed(() => {
  const count = 4;
  const { min, max } = yBounds.value;
  const ticks: Array<{ y: number; label: string }> = [];
  for (let i = 0; i <= count; i++) {
    const ratio = i / count;
    const val = max - ratio * (max - min);
    const y = PAD_TOP + ratio * plotH.value;
    ticks.push({ y, label: formatYValue(val) });
  }
  return ticks;
});

const coords = computed(() => {
  const pts = rawPoints.value;
  const len = pts.length;
  if (len === 0) return [];
  const { min, max } = yBounds.value;
  const span = max - min || 1;

  return pts.map((val, idx) => {
    const xRatio = len === 1 ? 0.5 : idx / (len - 1);
    const yRatio = (val - min) / span;
    const x = PAD_LEFT + xRatio * plotW.value;
    const y = PAD_TOP + (1 - yRatio) * plotH.value;
    return {
      idx,
      x,
      y,
      val,
      rawCategory: props.categories?.[idx],
    };
  });
});

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${(PAD_LEFT).toFixed(2)} ${p.y.toFixed(2)} L ${(PAD_LEFT + plotW.value).toFixed(2)} ${p.y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

const linePath = computed(() => buildSmoothPath(coords.value));

const areaPath = computed(() => {
  const pts = coords.value;
  if (pts.length === 0) return '';
  const baselineY = (PAD_TOP + plotH.value).toFixed(2);
  if (pts.length === 1) {
    const p = pts[0];
    const leftX = PAD_LEFT.toFixed(2);
    const rightX = (PAD_LEFT + plotW.value).toFixed(2);
    return `M ${leftX} ${p.y.toFixed(2)} L ${rightX} ${p.y.toFixed(2)} L ${rightX} ${baselineY} L ${leftX} ${baselineY} Z`;
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${linePath.value} L ${last.x.toFixed(2)} ${baselineY} L ${first.x.toFixed(2)} ${baselineY} Z`;
});

const xTicks = computed(() => {
  const pts = coords.value;
  if (pts.length === 0) return [];
  const desired = Math.min(6, pts.length);
  if (desired === 1) {
    return [{ x: pts[0].x, label: formatXLabel(pts[0].rawCategory) }];
  }
  const result: Array<{ x: number; label: string }> = [];
  const seenLabels = new Set<string>();
  for (let i = 0; i < desired; i++) {
    const idx = Math.round((i * (pts.length - 1)) / (desired - 1));
    const pt = pts[idx];
    const label = formatXLabel(pt.rawCategory);
    if (label && !seenLabels.has(label)) {
      seenLabels.add(label);
      result.push({ x: pt.x, label });
    }
  }
  return result;
});

const activePoint = computed(() => {
  if (hoveredIndex.value === null) return null;
  return coords.value[hoveredIndex.value] ?? null;
});

function onSvgMouseMove(event: MouseEvent) {
  const pts = coords.value;
  if (pts.length === 0) return;
  const svg = event.currentTarget as SVGSVGElement | null;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0) return;
  const relX = ((event.clientX - rect.left) / rect.width) * viewW.value;
  const clampedX = Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotW.value, relX));
  const ratio = (clampedX - PAD_LEFT) / (plotW.value || 1);
  const idx = Math.round(ratio * (pts.length - 1));
  hoveredIndex.value = Math.max(0, Math.min(pts.length - 1, idx));
}

function onSvgMouseLeave() {
  hoveredIndex.value = null;
}
</script>

<template>
  <div ref="containerRef" class="relative w-full select-none" :style="{ height: `${VIEW_H}px` }">
    <svg
      :viewBox="`0 0 ${viewW} ${VIEW_H}`"
      class="w-full h-full overflow-visible"
      role="img"
      :aria-label="activeSeries.name || 'Area chart'"
      @mousemove="onSvgMouseMove"
      @mouseleave="onSvgMouseLeave"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="primaryColor" stop-opacity="0.45" />
          <stop offset="100%" :stop-color="primaryColor" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Horizontal grid lines and Y labels -->
      <g v-for="(tick, idx) in yTicks" :key="`y-${idx}`">
        <line
          :x1="PAD_LEFT"
          :y1="tick.y"
          :x2="PAD_LEFT + plotW"
          :y2="tick.y"
          :stroke="palette.themeBorderColor"
          stroke-width="1"
        />
        <text
          :x="PAD_LEFT - 8"
          :y="tick.y"
          text-anchor="end"
          dominant-baseline="middle"
          :fill="palette.themeDisabledTextColor"
          style="font-size: 11px"
        >
          {{ tick.label }}
        </text>
      </g>

      <!-- Vertical grid lines and X labels -->
      <g v-for="(tick, idx) in xTicks" :key="`x-${idx}`">
        <line
          :x1="tick.x"
          :y1="PAD_TOP"
          :x2="tick.x"
          :y2="PAD_TOP + plotH"
          :stroke="palette.themeBorderColor"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <text
          :x="tick.x"
          :y="PAD_TOP + plotH + 16"
          text-anchor="middle"
          :fill="palette.themeDisabledTextColor"
          style="font-size: 11px"
        >
          {{ tick.label }}
        </text>
      </g>

      <!-- Area fill & stroke path -->
      <path v-if="areaPath" :d="areaPath" :fill="`url(#${gradientId})`" />
      <path
        v-if="linePath"
        :d="linePath"
        fill="none"
        :stroke="primaryColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <!-- Hover crosshair and active point -->
      <g v-if="activePoint" class="pointer-events-none">
        <line
          :x1="activePoint.x"
          :y1="PAD_TOP"
          :x2="activePoint.x"
          :y2="PAD_TOP + plotH"
          :stroke="palette.themeSecondaryTextColor"
          stroke-width="1"
          stroke-dasharray="4 4"
        />
        <circle
          :cx="activePoint.x"
          :cy="activePoint.y"
          r="4.5"
          :fill="primaryColor"
          stroke="#ffffff"
          stroke-width="1.5"
        />
      </g>
    </svg>

    <!-- Tooltip -->
    <div
      v-if="activePoint"
      class="pointer-events-none absolute top-2 z-10 rounded bg-neutral text-neutral-content px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
      :style="{
        left: `${Math.min(82, Math.max(10, (activePoint.x / viewW) * 100))}%`,
        transform: 'translateX(-50%)',
      }"
    >
      <div v-if="activePoint.rawCategory !== undefined" class="opacity-75 text-[11px] mb-0.5">
        {{ formatXLabel(activePoint.rawCategory, true) }}
      </div>
      <div class="flex items-center gap-1.5 font-semibold">
        <span
          class="w-2 h-2 rounded-full inline-block"
          :style="{ backgroundColor: primaryColor }"
        ></span>
        <span v-if="activeSeries.name">{{ activeSeries.name }}:</span>
        <span>{{ formatYValue(activePoint.val) }}</span>
      </div>
    </div>
  </div>
</template>
