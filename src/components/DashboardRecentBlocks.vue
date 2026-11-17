<script setup lang="ts">
import { computed } from 'vue';
import { selectRecentDashboardBlocks } from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';

const props = defineProps<{ chain: string }>();

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const format = useFormatter();

const chainMatched = computed(
  () => !blockchain.chainName || blockchain.chainName === props.chain
);

const recentBlocks = computed(() => {
  if (!chainMatched.value) return [];
  return selectRecentDashboardBlocks(
    baseStore.recents,
    baseStore.currentChainId,
    7
  );
});
</script>

<template>
  <section
    class="bg-base-100 rounded mt-4 shadow p-4"
    aria-labelledby="dashboard-recent-blocks-heading"
    data-dashboard-recent-blocks
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 id="dashboard-recent-blocks-heading" class="text-lg font-semibold text-main">
        Recent Blocks
      </h2>
      <RouterLink
        :to="`/${chain}/block`"
        class="text-sm link link-primary no-underline"
      >
        {{ $t('index.more') }}
      </RouterLink>
    </div>
    <p class="text-xs text-base-content/70 mb-3">
      Up to 7 latest unique blocks from the recent cache
      ({{ baseStore.isContiguous ? 'contiguous window' : 'cached samples, continuity not guaranteed' }}).
    </p>
    <div
      v-if="baseStore.lastPollError && recentBlocks.length === 0"
      role="alert"
      class="text-sm text-error py-2"
    >
      Could not load recent blocks: {{ baseStore.lastPollError }}
    </div>
    <p
      v-else-if="recentBlocks.length === 0"
      role="status"
      class="text-sm py-2"
    >
      No recent cached blocks available yet.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="table table-compact w-full text-sm">
        <thead>
          <tr>
            <th>{{ $t('account.height') }}</th>
            <th>Proposer</th>
            <th>{{ $t('block.txs') }}</th>
            <th>{{ $t('account.time') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in recentBlocks"
            :key="item.block.header.height"
          >
            <td>
              <RouterLink
                class="text-primary underline underline-offset-4 tabular-nums"
                :to="`/${chain}/block/${item.block.header.height}`"
              >
                {{ item.block.header.height }}
              </RouterLink>
            </td>
            <td class="truncate max-w-[200px]">
              {{ format.validator(item.block?.header?.proposer_address) || '-' }}
            </td>
            <td class="tabular-nums">
              {{ item.block?.data?.txs?.length || 0 }}
            </td>
            <td class="tabular-nums">
              <time
                v-if="item.block?.header?.time"
                :datetime="item.block.header.time"
              >
                {{ format.toDay(item.block.header.time, 'short') }}
              </time>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
