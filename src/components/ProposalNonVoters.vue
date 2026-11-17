<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { resolveRpcEndpoint } from '@/libs/abci';
import {
  computeActiveProposalNonVoters,
  type NonVotersResult,
} from '@/libs/govHelpers';
import { useBaseStore, useBlockchain } from '@/stores';

const props = defineProps<{
  proposalId: string;
  chain: string;
  proposalStatus?: string;
}>();

const blockchain = useBlockchain();
const baseStore = useBaseStore();

const loading = ref(false);
const result = ref<NonVotersResult | null>(null);
let generation = 0;

const isActiveProposal = computed(
  () =>
    props.proposalStatus === 'PROPOSAL_STATUS_VOTING_PERIOD' ||
    props.proposalStatus === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
);

const rpcEndpoint = computed(() => resolveRpcEndpoint(blockchain.current));

async function loadNonVoters() {
  const req = ++generation;
  result.value = null;

  if (!props.proposalStatus) return;
  if (!isActiveProposal.value) {
    result.value = {
      available: false,
      height: '',
      nonVoters: [],
      bondedCount: 0,
      votedBondedCount: 0,
      reason:
        'Unavailable for closed proposals: historical per-proposal validator snapshots and final-round vote sets cannot be verified without archive snapshot proof.',
    };
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    let height = baseStore.latest?.block?.header?.height || '';
    if (!height && blockchain.rpc?.getBaseBlockLatest) {
      const latest = await blockchain.rpc.getBaseBlockLatest();
      if (req !== generation) return;
      height = latest?.block?.header?.height || '';
    }
    const computedNonVoters = await computeActiveProposalNonVoters(
      rpcEndpoint.value,
      props.proposalId,
      height
    );
    if (req !== generation) return;
    result.value = computedNonVoters;
  } catch (cause) {
    if (req !== generation) return;
    result.value = {
      available: false,
      height: '',
      nonVoters: [],
      bondedCount: 0,
      votedBondedCount: 0,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    if (req === generation) loading.value = false;
  }
}

watch(
  () => [
    props.proposalId,
    props.chain,
    props.proposalStatus,
    blockchain.chainName,
    rpcEndpoint.value,
  ],
  async () => {
    const reset = ++generation;
    result.value = null;
    loading.value = Boolean(props.proposalId && isActiveProposal.value);
    await nextTick();
    if (reset !== generation) return;
    if (props.proposalId && blockchain.chainName === props.chain) {
      void loadNonVoters();
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
    aria-labelledby="proposal-nonvoters-heading"
    data-proposal-nonvoters
  >
    <h2 id="proposal-nonvoters-heading" class="card-title mb-1">
      Non-Voting Validators
    </h2>
    <p v-if="loading" role="status" class="py-3 text-sm">
      Loading active bonded validators and votes at a consistent height...
    </p>
    <div
      v-else-if="!result?.available"
      role="status"
      class="py-3 text-sm text-base-content/80"
    >
      {{ result?.reason || 'Non-voting validators unavailable.' }}
    </div>
    <template v-else>
      <p class="text-xs text-base-content/70 mb-3">
        Based on current active (bonded) validators at height #{{ result.height }}
        ({{ result.votedBondedCount }}/{{ result.bondedCount }} bonded validators voted; not a historical proposal-creation snapshot).
      </p>
      <p v-if="result.nonVoters.length === 0" role="status" class="py-2 text-sm">
        All {{ result.bondedCount }} active bonded validators have voted.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="table table-compact w-full text-sm">
          <thead>
            <tr>
              <th>Validator</th>
              <th>Operator Address</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in result.nonVoters" :key="v.operatorAddress">
              <td>{{ v.moniker }}</td>
              <td>
                <RouterLink
                  class="text-primary underline underline-offset-4"
                  :to="`/${chain}/staking/${v.operatorAddress}`"
                >
                  {{ v.operatorAddress }}
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
