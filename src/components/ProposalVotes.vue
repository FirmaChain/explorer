<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { fromBech32, toHex } from '@cosmjs/encoding';
import { useBlockchain, useGovStore, useStakingStore } from '@/stores';
import {
  filterNormalizedVotes,
  normalizeVoteRecord,
  type NormalizedVote,
} from '@/libs/govHelpers';
import { PageRequest } from '@/types';

const props = defineProps<{
  proposalId: string;
  chain: string;
  proposalStatus?: string;
}>();

const govStore = useGovStore();
const blockchain = useBlockchain();
const stakingStore = useStakingStore();

const loading = ref(false);
const error = ref('');
const partialWarning = ref('');
const allVotes = ref<NormalizedVote[]>([]);
const selectedOption = ref('ALL');
const currentPage = ref(0);
const pageSize = 20;
let generation = 0;

const isClosedProposal = computed(() =>
  Boolean(
    props.proposalStatus &&
      props.proposalStatus !== 'PROPOSAL_STATUS_DEPOSIT_PERIOD' &&
      props.proposalStatus !== 'PROPOSAL_STATUS_VOTING_PERIOD'
  )
);

function showValidatorName(voter: string) {
  try {
    const { data } = fromBech32(voter);
    const hex = toHex(data);
    const v = stakingStore.validators.find(
      (x) => toHex(fromBech32(x.operator_address).data) === hex
    );
    return v ? v.description.moniker : voter;
  } catch {
    return voter;
  }
}

const filteredVotes = computed(() =>
  filterNormalizedVotes(allVotes.value, selectedOption.value)
);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredVotes.value.length / pageSize))
);

const pagedVotes = computed(() => {
  const start = currentPage.value * pageSize;
  return filteredVotes.value.slice(start, start + pageSize);
});

watch(selectedOption, () => {
  currentPage.value = 0;
});

async function loadAllVotes() {
  const req = ++generation;
  loading.value = true;
  error.value = '';
  partialWarning.value = '';
  allVotes.value = [];
  currentPage.value = 0;

  const collected: NormalizedVote[] = [];
  const seenCursors = new Set<string>();
  let nextKey = '';

  try {
    for (;;) {
      const page = new PageRequest();
      page.setPageSize(100);
      page.count_total = false;
      if (nextKey) page.key = nextKey;

      const res = await govStore.fetchProposalVotes(props.proposalId, page);
      if (req !== generation) return;

      const batch = Array.isArray(res?.votes) ? res.votes : [];
      for (const vote of batch) {
        collected.push(normalizeVoteRecord(vote));
      }

      const cursor = res?.pagination?.next_key || '';
      if (!cursor) break;
      if (seenCursors.has(cursor)) {
        partialWarning.value =
          'Node returned a repeated pagination cursor; displayed vote list may be incomplete.';
        break;
      }
      seenCursors.add(cursor);
      nextKey = cursor;
    }
    allVotes.value = collected;
  } catch (cause) {
    if (req !== generation) return;
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (collected.length > 0) {
      allVotes.value = collected;
      partialWarning.value = `Partial votes loaded before error: ${msg}`;
    } else {
      error.value = msg;
    }
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
    blockchain.endpoint.address,
  ],
  async () => {
    const reset = ++generation;
    selectedOption.value = 'ALL';
    await nextTick();
    if (reset !== generation) return;
    if (props.proposalId && blockchain.chainName === props.chain) {
      void loadAllVotes();
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
    aria-labelledby="proposal-votes-heading"
    data-proposal-votes
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 id="proposal-votes-heading" class="card-title">
        {{ $t('gov.votes') }} ({{ filteredVotes.length }})
      </h2>
      <div
        v-if="allVotes.length > 0"
        class="btn-group"
        role="group"
        aria-label="Filter votes by option"
      >
        <button
          v-for="opt in [
            ['ALL', 'All'],
            ['YES', 'Yes'],
            ['NO', 'No'],
            ['NO_WITH_VETO', 'Veto'],
            ['ABSTAIN', 'Abstain'],
          ]"
          :key="opt[0]"
          type="button"
          class="btn btn-xs"
          :class="{ 'btn-active': selectedOption === opt[0] }"
          @click="selectedOption = opt[0]"
        >
          {{ opt[1] }}
        </button>
      </div>
    </div>
    <p class="text-xs text-base-content/70 mb-3">
      Weighted voters appear under every option where their weight is greater than 0.
    </p>

    <p v-if="loading" role="status" class="py-3 text-sm">
      Loading votes...
    </p>
    <div v-else-if="error" role="alert" class="py-3 text-sm text-error">
      Could not load votes. {{ error }}
      <button type="button" class="btn btn-xs ml-2" @click="loadAllVotes">
        Retry
      </button>
    </div>
    <template v-else>
      <div
        v-if="partialWarning"
        role="alert"
        class="alert alert-warning text-xs py-2 mb-3"
      >
        <span>{{ partialWarning }}</span>
      </div>
      <div
        v-if="filteredVotes.length === 0"
        role="status"
        class="py-3 text-sm text-base-content/80"
      >
        <template v-if="isClosedProposal && allVotes.length === 0">
          No current vote records returned by the node for this closed proposal (historical vote reconstruction unavailable without complete block/tx archive evidence).
        </template>
        <template v-else-if="allVotes.length === 0">
          No votes found for this proposal.
        </template>
        <template v-else>
          No votes match the selected option filter.
        </template>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="table w-full table-zebra text-sm">
          <tbody>
            <tr v-for="(item, index) in pagedVotes" :key="`${item.voter}-${index}`">
              <td class="py-2">
                <RouterLink
                  class="text-primary underline underline-offset-4"
                  :to="`/${chain}/account/${item.voter}`"
                >
                  {{ showValidatorName(item.voter) }}
                </RouterLink>
              </td>
              <td class="py-2">{{ item.summary }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="filteredVotes.length > pageSize"
        class="mt-3 flex items-center gap-3"
      >
        <button
          type="button"
          class="btn btn-xs"
          :disabled="currentPage === 0"
          @click="currentPage -= 1"
        >
          Previous
        </button>
        <span class="text-xs tabular-nums">
          Page {{ currentPage + 1 }} / {{ totalPages }}
        </span>
        <button
          type="button"
          class="btn btn-xs"
          :disabled="currentPage + 1 >= totalPages"
          @click="currentPage += 1"
        >
          Next
        </button>
      </div>
    </template>
  </section>
</template>
