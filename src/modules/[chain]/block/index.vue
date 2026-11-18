<!-- Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, ref } from 'vue';
import { useBaseStore, useFormatter } from '@/stores';
import TxsInBlocksChart from '@/components/charts/TxsInBlocksChart.vue';

const props = defineProps(['chain']);

const tab = ref('blocks');

const base = useBaseStore();

const format = useFormatter();

const list = computed(() => {
  // const recents = base.recents
  // return recents.sort((a, b) => (Number(b.block.header.height) - Number(a.block.header.height)))
  return base.recents;
});
</script>
<template>
  <div>
    <div class="tabs tabs-boxed bg-transparent mb-4">
      <a class="tab text-base-content/60 uppercase" :class="{ 'tab-active': tab === 'blocks' }" @click="tab = 'blocks'">{{
        $t('block.recent')
      }}</a>
      <RouterLink
        class="tab text-base-content/60 uppercase"
        :to="`/${chain}/block/${Number(base.latest?.block?.header.height || 0) + 10000}`"
        >{{ $t('block.future') }}</RouterLink
      >
    </div>

    <div v-show="tab === 'blocks'">
      <div
        v-if="base.fetchAllBlocks && base.missingHeights.length > 0"
        role="alert"
        class="alert alert-warning text-xs py-2 mb-3"
      >
        <span>
          Partial recent block window: missing height(s)
          {{ base.missingHeights.join(', ') }}. Will retry on next poll.
        </span>
      </div>
      <div
        v-else-if="base.fetchAllBlocks && base.isContiguous"
        role="status"
        class="alert alert-success text-xs py-2 mb-3"
      >
        <span>
          Contiguous recent block cache ({{ base.recents.length }} blocks within
          window limit {{ base.windowLimit }}).
        </span>
      </div>

      <TxsInBlocksChart />

      <div class="grid xl:!grid-cols-6 md:!grid-cols-4 grid-cols-1 gap-3">
        <RouterLink
          v-for="item in list"
          class="flex flex-col justify-between rounded p-4 shadow bg-base-100"
          :to="`/${chain}/block/${item.block.header.height}`"
        >
          <div class="flex justify-between">
            <h3 class="text-md font-bold sm:!text-lg">
              {{ item.block.header.height }}
            </h3>
            <span class="rounded text-xs whitespace-nowrap font-medium text-success">
              {{ format.toDay(item.block?.header?.time, 'from') }}
            </span>
          </div>
          <div class="flex justify-between tooltip" data-tip="Block Proposor">
            <div class="mt-2 hidden text-sm sm:!block truncate">
              <span>{{ format.validator(item.block?.header?.proposer_address) }}</span>
            </div>
            <span class="text-right mt-1 whitespace-nowrap"> {{ item.block?.data?.txs.length }} txs </span>
          </div>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<route>
    {
      meta: {
        i18n: 'blocks',
        order: 5
      }
    }
  </route>
