<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs/address';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';
import {
  buildBlockSignatures,
  fetchValidatorSetAtHeight,
  type BlockSignaturesSummary,
} from '@/libs/blockSignatures';
import { useValidatorAvatars } from '@/libs/validatorAvatar';
import type { Validator } from '@/types';

const props = defineProps<{
  height: number | string;
  chain: string;
  latestHeight?: number | string;
}>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const format = useFormatter();

const { logoUrl, loadAvatar } = useValidatorAvatars(
  typeof stakingStore.keybase === 'function'
    ? (identity) => stakingStore.keybase(identity)
    : undefined
);

const status = ref<'idle' | 'loading' | 'loaded' | 'pending_next' | 'error'>('idle');
const error = ref('');
const validatorSetWarning = ref('');
const summary = ref<BlockSignaturesSummary | null>(null);
const pageSize = 10;
const currentPage = ref(1);
let generation = 0;

const stakingByHex = computed(() => {
  const map = new Map<string, Validator>();
  for (const v of stakingStore.validators || []) {
    const hex = normalizeConsensusHex(
      consensusPubkeyToHexAddress(v.consensus_pubkey)
    );
    if (hex) map.set(hex, v);
  }
  return map;
});

const enrichedRows = computed(() => {
  const rows = summary.value?.rows || [];
  return rows.map((row) => {
    const sv = row.consensusHex
      ? stakingByHex.value.get(row.consensusHex)
      : undefined;
    if (!sv) return row;
    return {
      ...row,
      moniker: row.moniker || sv.description?.moniker || '',
      operatorAddress: row.operatorAddress || sv.operator_address || '',
      identity: row.identity || sv.description?.identity || '',
    };
  });
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(enrichedRows.value.length / pageSize))
);

const safePage = computed(() => Math.min(currentPage.value, totalPages.value));

const paginatedRows = computed(() => {
  const start = (safePage.value - 1) * pageSize;
  return enrichedRows.value.slice(start, start + pageSize);
});

watch(
  paginatedRows,
  (rows) => {
    for (const row of rows) {
      if (row.identity) loadAvatar(row.identity);
    }
  },
  { immediate: true }
);

async function loadSignatures() {
  const req = ++generation;
  const h = Number(props.height);
  error.value = '';
  validatorSetWarning.value = '';
  summary.value = null;

  if (!Number.isInteger(h) || h < 1) {
    status.value = 'error';
    error.value = 'Invalid block height for signatures.';
    return;
  }

  const latestNum = Number(props.latestHeight || 0);
  if (latestNum > 0 && h >= latestNum) {
    status.value = 'pending_next';
    return;
  }

  if (!blockchain.rpc) {
    status.value = 'error';
    error.value = 'RPC client is unavailable.';
    return;
  }

  status.value = 'loading';
  try {
    const [nextBlock, valSet] = await Promise.all([
      blockchain.rpc.getBaseBlockAt(String(h + 1)),
      fetchValidatorSetAtHeight(blockchain.rpc, h),
    ]);
    if (req !== generation) return;

    if (!nextBlock?.block?.header?.height) {
      status.value = 'pending_next';
      return;
    }

    if (!valSet.complete) {
      validatorSetWarning.value =
        valSet.error || 'Validator set at this height is unavailable or pruned.';
    }

    summary.value = buildBlockSignatures(
      h,
      nextBlock,
      valSet.validators,
      stakingStore.validators,
      valSet.complete
    );
    status.value = 'loaded';
  } catch (cause) {
    if (req !== generation) return;
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (/404|not found/i.test(msg)) {
      status.value = 'pending_next';
      return;
    }
    status.value = 'error';
    error.value = msg;
  }
}

watch(
  () => [
    props.height,
    props.chain,
    props.latestHeight,
    blockchain.chainName,
    blockchain.endpoint.address,
  ],
  async (nextVal, prevVal) => {
    const contextChanged =
      !prevVal ||
      prevVal[0] !== nextVal[0] ||
      prevVal[1] !== nextVal[1] ||
      prevVal[3] !== nextVal[3] ||
      prevVal[4] !== nextVal[4];

    if (!contextChanged) {
      if (
        status.value !== 'pending_next' ||
        Number(nextVal[2] || 0) <= Number(nextVal[0])
      ) {
        return;
      }
    } else {
      currentPage.value = 1;
    }

    const reset = ++generation;
    await nextTick();
    if (reset !== generation) return;
    if (blockchain.chainName === props.chain) {
      void loadSignatures();
    }
  },
  { immediate: true, flush: 'sync' }
);

onScopeDispose(() => {
  ++generation;
});
</script>

<template>
  <section
    class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow"
    aria-labelledby="block-signatures-heading"
    data-block-signatures
  >
    <h2 id="block-signatures-heading" class="card-title mb-1">
      Block #{{ height }} Signatures
    </h2>
    <p class="text-xs text-base-content/70 mb-3">
      Commit signatures recorded in block #{{ Number(height) + 1 }}
      (last_commit for height #{{ height }}).
    </p>

    <p v-if="status === 'loading'" role="status" class="py-3 text-sm">
      Loading block signatures...
    </p>
    <p v-else-if="status === 'pending_next'" role="status" class="py-3 text-sm">
      Waiting for block #{{ Number(height) + 1 }} to confirm signatures for block
      #{{ height }}.
    </p>
    <div v-else-if="status === 'error'" role="alert" class="py-3 text-sm text-error">
      Could not load signatures for block #{{ height }}. {{ error }}
    </div>
    <template v-else-if="summary">
      <div
        v-if="validatorSetWarning"
        role="alert"
        class="alert alert-warning text-xs py-2 mb-3"
      >
        <span>
          Validator set mapping/voting power unavailable:
          {{ validatorSetWarning }}
        </span>
      </div>
      <div class="text-xs mb-3 flex flex-wrap gap-4">
        <span>Signed: {{ summary.signedCount }}</span>
        <span>Nil: {{ summary.nilCount }}</span>
        <span>Absent: {{ summary.absentCount }}</span>
        <span v-if="summary.powerAvailable">
          Signed Voting Power: {{ summary.signedPower.toString() }} /
          {{ summary.totalPower.toString() }}
        </span>
        <span v-else>Signed Voting Power: Unavailable</span>
      </div>
      <p v-if="!summary.rows.length" role="status" class="py-2 text-sm">
        No commit signatures recorded for block #{{ height }}.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="table table-compact w-full text-sm">
          <thead>
            <tr>
              <th>Validator</th>
              <th>Status</th>
              <th>Voting Power</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in paginatedRows" :key="row.key">
              <td class="max-w-[260px]">
                <RouterLink
                  v-if="row.operatorAddress"
                  class="inline-flex items-center gap-2 text-primary hover:underline underline-offset-4 max-w-full"
                  :to="`/${chain}/staking/${row.operatorAddress}`"
                >
                  <span
                    class="avatar w-6 h-6 rounded-full shrink-0 overflow-hidden bg-base-200 flex items-center justify-center"
                  >
                    <img
                      v-if="logoUrl(row.identity)"
                      :src="logoUrl(row.identity)"
                      :alt="row.moniker || row.operatorAddress"
                      class="w-6 h-6 object-cover rounded-full"
                    />
                    <Icon
                      v-else
                      icon="mdi-help-circle-outline"
                      class="w-5 h-5 text-base-content/60"
                    />
                  </span>
                  <span class="truncate">{{ row.moniker || row.operatorAddress }}</span>
                </RouterLink>
                <span v-else class="inline-flex items-center gap-2 max-w-full">
                  <span
                    class="avatar w-6 h-6 rounded-full shrink-0 overflow-hidden bg-base-200 flex items-center justify-center"
                  >
                    <Icon
                      icon="mdi-help-circle-outline"
                      class="w-5 h-5 text-base-content/60"
                    />
                  </span>
                  <span class="truncate">{{ row.consensusHex || 'Unknown validator' }}</span>
                </span>
              </td>
              <td>{{ row.status }}</td>
              <td class="tabular-nums">{{ row.votingPower || '-' }}</td>
              <td class="tabular-nums">
                {{ row.timestamp ? format.toDay(row.timestamp, 'short') : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
        <nav
          aria-label="Block signature pages"
          class="mt-4 flex flex-wrap items-center gap-3"
          data-block-signatures-pagination
        >
          <button
            class="btn btn-sm"
            type="button"
            :disabled="safePage <= 1"
            @click="currentPage = Math.max(1, safePage - 1)"
          >
            Previous
          </button>
          <span class="tabular-nums" aria-live="polite">
            Page {{ safePage }} / {{ totalPages }}
          </span>
          <button
            class="btn btn-sm signatures-primary"
            type="button"
            :disabled="safePage >= totalPages"
            @click="currentPage = Math.min(totalPages, safePage + 1)"
          >
            Next
          </button>
        </nav>
      </div>
    </template>
  </section>
</template>

<style scoped>
.signatures-primary:not(:disabled) {
  background-color: hsl(var(--bc));
  color: hsl(var(--b1));
}
.signatures-primary:not(:disabled):hover {
  background-color: hsl(var(--bc) / 0.9);
}
</style>
