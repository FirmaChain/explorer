<script setup lang="ts">
import { computed } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import { normalizeConsensusHex } from '@/libs';
import type { Block } from '@/types';

const props = defineProps<{
  validator: string;
  chain: string;
  consensusHex?: string;
  loading?: boolean;
  error?: string;
}>();

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const format = useFormatter();

const validatorHex = computed(() => normalizeConsensusHex(props.consensusHex));

const chainMatched = computed(() => blockchain.chainName === props.chain);

const cachedWindow = computed(() => {
  if (!chainMatched.value) {
    return {
      blocks: [] as Block[],
      minHeight: 0,
      maxHeight: 0,
      hasGaps: false,
    };
  }
  const expectedChainId = baseStore.currentChainId;
  const seenHeights = new Set<string>();
  const unique: Block[] = [];
  for (const block of baseStore.recents || []) {
    const header = block?.block?.header;
    if (!header?.height) continue;
    if (expectedChainId && header.chain_id && header.chain_id !== expectedChainId) {
      continue;
    }
    const h = String(header.height);
    if (seenHeights.has(h)) continue;
    seenHeights.add(h);
    unique.push(block);
  }
  unique.sort(
    (a, b) => Number(b.block.header.height) - Number(a.block.header.height)
  );
  const heights = unique
    .map((b) => Number(b.block.header.height))
    .filter((n) => Number.isFinite(n));
  const maxHeight = heights.length ? heights[0] : 0;
  const minHeight = heights.length ? heights[heights.length - 1] : 0;
  let hasGaps = false;
  for (let i = 1; i < heights.length; i++) {
    if (heights[i - 1] - heights[i] > 1) {
      hasGaps = true;
      break;
    }
  }
  return { blocks: unique, minHeight, maxHeight, hasGaps };
});

const proposedBlocks = computed(() => {
  if (!validatorHex.value || !chainMatched.value) return [];
  return cachedWindow.value.blocks.filter(
    (b) =>
      normalizeConsensusHex(b.block?.header?.proposer_address) ===
      validatorHex.value
  );
});
</script>

<template>
  <section
    class="mt-5 bg-base-100 shadow rounded p-4"
    aria-labelledby="proposed-blocks-heading"
    data-validator-proposed-blocks
  >
    <h2 id="proposed-blocks-heading" class="text-lg font-semibold">
      Recent Proposed Blocks
    </h2>
    <p class="text-sm text-base-content/70 mt-1 mb-4">
      <template v-if="cachedWindow.blocks.length > 0">
        Matched from the recent cached block window (heights
        {{ cachedWindow.minHeight }}–{{ cachedWindow.maxHeight }},
        {{ cachedWindow.blocks.length }} cached blocks{{
          cachedWindow.hasGaps ? ', non-contiguous' : ''
        }}). This is not the validator's complete historical block list.
      </template>
      <template v-else>
        Matched only against the recent in-memory block cache, not full chain
        history.
      </template>
    </p>
    <div :aria-busy="Boolean(loading)">
      <p v-if="loading" role="status" class="py-4">
        Loading validator consensus address...
      </p>
      <div v-else-if="error" role="alert" class="py-4">
        Could not resolve validator consensus address. {{ error }}
      </div>
      <p v-else-if="!validatorHex" role="status" class="py-4">
        Validator consensus address is unavailable.
      </p>
      <p v-else-if="!cachedWindow.blocks.length" role="status" class="py-4">
        No recent cached blocks are available yet.
      </p>
      <p v-else-if="!proposedBlocks.length" role="status" class="py-4">
        No blocks in the recent cached window were proposed by this validator.
      </p>
      <table v-else class="table w-full proposed-blocks-table">
        <thead>
          <tr>
            <th scope="col" class="text-base-content">
              {{ $t('account.height') }}
            </th>
            <th scope="col" class="text-base-content">
              {{ $t('block.txs') }}
            </th>
            <th scope="col" class="text-base-content">
              {{ $t('account.time') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in proposedBlocks"
            :key="item.block.header.height"
          >
            <td>
              <RouterLink
                class="inline-block min-h-12 py-2 text-primary underline underline-offset-4"
                :to="`/${chain}/block/${item.block.header.height}`"
              >
                {{ item.block.header.height }}
              </RouterLink>
            </td>
            <td class="tabular-nums">
              {{ item.block?.data?.txs?.length || 0 }}
            </td>
            <td>
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

<style scoped>
.proposed-blocks-table {
  table-layout: fixed;
}
.proposed-blocks-table :where(th, td) {
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.proposed-blocks-table td {
  font-variant-numeric: tabular-nums;
}
</style>
