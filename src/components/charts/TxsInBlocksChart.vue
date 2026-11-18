<!-- Modified by FirmaChain (2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { useBaseStore } from '@/stores';
import { colorVariables } from './chartConfig';

const baseStore = useBaseStore();
const hoveredIndex = ref<number | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const viewW = ref(720);

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

const VIEW_H = 150;
const PAD_LEFT = 36;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 16;
const SLOT_COUNT = 50;
const BAR_COLOR = '#5A67D8';

const plotW = computed(() => Math.max(60, viewW.value - PAD_LEFT - PAD_RIGHT));
const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;

const palette = computed(() => colorVariables(baseStore.theme));

const recentEntries = computed(() => {
  const list = Array.isArray(baseStore.recents) ? baseStore.recents.slice(0, SLOT_COUNT) : [];
  return list.map((x) => ({
    height: String(x?.block?.header?.height ?? ''),
    txs: Array.isArray(x?.block?.data?.txs) ? x.block.data.txs.length : 0,
  }));
});

const maxTxs = computed(() => {
  const maxVal = recentEntries.value.reduce((acc, item) => Math.max(acc, item.txs), 0);
  return Math.max(4, Math.ceil(maxVal * 1.1));
});

const yTicks = computed(() => {
  const top = maxTxs.value;
  const mid = Math.round(top / 2);
  return [
    { y: PAD_TOP, label: String(top) },
    { y: PAD_TOP + plotH / 2, label: String(mid) },
    { y: PAD_TOP + plotH, label: '0' },
  ];
});

const bars = computed(() => {
  const slotW = plotW.value / SLOT_COUNT;
  const barW = Math.max(2, slotW * 0.68);
  const offset = (slotW - barW) / 2;
  const maxVal = maxTxs.value || 1;

  return recentEntries.value.map((entry, index) => {
    const ratio = Math.min(1, Math.max(0, entry.txs / maxVal));
    const h = entry.txs > 0 ? Math.max(3, ratio * plotH) : 1.5;
    const x = PAD_LEFT + index * slotW + offset;
    const y = PAD_TOP + plotH - h;
    return {
      index,
      height: entry.height,
      txs: entry.txs,
      x,
      y,
      w: barW,
      h,
      centerX: x + barW / 2,
    };
  });
});

const activeBar = computed(() => {
  if (hoveredIndex.value === null) return null;
  return bars.value[hoveredIndex.value] ?? null;
});
</script>

<template>
  <div ref="containerRef" class="relative w-full h-[150px] mb-2 select-none">
    <svg
      :viewBox="`0 0 ${viewW} ${VIEW_H}`"
      class="w-full h-full overflow-visible"
      role="img"
      aria-label="Transactions in recent blocks"
    >
      <g v-for="(tick, idx) in yTicks" :key="`y-${idx}`">
        <line
          :x1="PAD_LEFT"
          :y1="tick.y"
          :x2="PAD_LEFT + plotW"
          :y2="tick.y"
          :stroke="palette.themeBorderColor"
          stroke-width="1"
          :stroke-dasharray="idx < yTicks.length - 1 ? '3 3' : undefined"
        />
        <text
          :x="PAD_LEFT - 6"
          :y="tick.y"
          text-anchor="end"
          dominant-baseline="middle"
          :fill="palette.themeDisabledTextColor"
          style="font-size: 10px"
        >
          {{ tick.label }}
        </text>
      </g>

      <g v-for="bar in bars" :key="`bar-${bar.index}`">
        <rect
          :x="bar.x"
          :y="PAD_TOP"
          :width="bar.w"
          :height="plotH"
          fill="transparent"
          class="cursor-pointer"
          @mouseenter="hoveredIndex = bar.index"
          @mouseleave="hoveredIndex = null"
        />
        <rect
          :x="bar.x"
          :y="bar.y"
          :width="bar.w"
          :height="bar.h"
          rx="1.5"
          :fill="BAR_COLOR"
          :opacity="hoveredIndex !== null && hoveredIndex !== bar.index ? 0.55 : 1"
          class="pointer-events-none transition-opacity duration-100"
        />
      </g>
    </svg>

    <div
      v-if="activeBar"
      class="pointer-events-none absolute top-1 z-10 rounded bg-neutral text-neutral-content px-2.5 py-1 text-xs shadow-lg whitespace-nowrap"
      :style="{
        left: `${Math.min(88, Math.max(12, (activeBar.centerX / viewW) * 100))}%`,
        transform: 'translateX(-50%)',
      }"
    >
      <div v-if="activeBar.height" class="opacity-75 text-[11px]">
        #{{ activeBar.height }}
      </div>
      <div class="flex items-center gap-1.5 font-semibold">
        <span
          class="w-2 h-2 rounded-full inline-block"
          :style="{ backgroundColor: BAR_COLOR }"
        ></span>
        <span>Txs: {{ activeBar.txs }}</span>
      </div>
    </div>
  </div>
</template>
