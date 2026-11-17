<script lang="ts" setup>
import ApexCharts from 'vue3-apexcharts';
import { getMarketPriceChartConfig } from './apexChartConfig';
import { useIndexModule } from '@/modules/[chain]/indexStore';
import { computed, ref } from '@vue/reactivity';
import { useBaseStore } from '@/stores';

const store = useIndexModule();
const baseStore = useBaseStore();
const chartConfig = computed(() => {
  const theme = baseStore.theme;
  const labels = store.marketData.prices.map((item: any) => item[0]);
  return getMarketPriceChartConfig(theme, labels);
});
const kind = ref('price');
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
  <ApexCharts type="area" height="230" :options="chartConfig" :series="series" />
</template>
