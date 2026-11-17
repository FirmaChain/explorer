<script setup lang="ts">
import { nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';
import {
  buildBlockSignatures,
  fetchValidatorSetAtHeight,
  type BlockSignaturesSummary,
} from '@/libs/blockSignatures';

const props = defineProps<{
  height: number | string;
  chain: string;
  latestHeight?: number | string;
}>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const format = useFormatter();

const status = ref<'idle' | 'loading' | 'loaded' | 'pending_next' | 'error'>('idle');
const error = ref('');
const validatorSetWarning = ref('');
const summary = ref<BlockSignaturesSummary | null>(null);
let generation = 0;

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
  async () => {
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
            <tr v-for="row in summary.rows" :key="row.key">
              <td>
                <RouterLink
                  v-if="row.operatorAddress"
                  class="text-primary underline underline-offset-4"
                  :to="`/${chain}/staking/${row.operatorAddress}`"
                >
                  {{ row.moniker || row.operatorAddress }}
                </RouterLink>
                <span v-else>{{ row.consensusHex || 'Unknown validator' }}</span>
              </td>
              <td>{{ row.status }}</td>
              <td class="tabular-nums">{{ row.votingPower || '-' }}</td>
              <td class="tabular-nums">
                {{ row.timestamp ? format.toDay(row.timestamp, 'short') : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
