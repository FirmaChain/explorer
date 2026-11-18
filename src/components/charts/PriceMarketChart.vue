<!-- Modified by FirmaChain (2026-11-17, 2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, ref } from 'vue';
import AreaChart from './AreaChart.vue';
import { useIndexModule } from '@/modules/[chain]/indexStore';

const store = useIndexModule();
const kind = ref('price');

const categories = computed(() => {
  const source =
    kind.value === 'price'
      ? store.marketData.prices
      : store.marketData.total_volumes;
  return Array.isArray(source) ? source.map((item: any) => item[0]) : [];
});

const series = computed(() => {
  return [
    {
      name: kind.value === 'price' ? 'Price' : 'Volume',
      data:
        kind.value === 'price'
          ? store.marketData.prices.map((item: any) => item[1])
          : store.marketData.total_volumes.map((item: any) => item[1]),
    },
  ];
});

function changeChart(type: string) {
  kind.value = type;
}
</script>

<template>
  <div class="tabs tabs-boxed bg-transparent justify-end gap-1 p-0 mb-1">
    <a
      class="tab text-xs uppercase"
      :class="kind === 'price' ? 'tab-active !text-white' : 'text-base-content/60'"
      @click="changeChart('price')"
    >
      Price
    </a>
    <a
      class="tab text-xs uppercase"
      :class="kind === 'volume' ? 'tab-active !text-white' : 'text-base-content/60'"
      @click="changeChart('volume')"
    >
      Volume
    </a>
  </div>
  <AreaChart :height="230" :categories="categories" :series="series" />
</template>
