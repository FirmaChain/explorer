<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter, useGovStore } from '@/stores';
import { PageRequest, type GovDeposit } from '@/types';
import {
  reconstructClosedProposalDeposits,
  type HistoricalDepositEvent,
} from '@/libs/govHelpers';

const props = defineProps<{
  proposalId: string;
  chain: string;
  proposalStatus?: string;
}>();

const govStore = useGovStore();
const blockchain = useBlockchain();
const format = useFormatter();

const pageSize = 10;
const rows = ref<GovDeposit[]>([]);
const loading = ref(false);
const error = ref('');
const current = ref(0);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextKey = ref('');
const historicalEvents = ref<HistoricalDepositEvent[]>([]);
const historicalUnavailableReason = ref('');
let generation = 0;

class RepeatedDepositCursor extends Error {
  constructor() {
    super(
      'The node returned a repeated page cursor. Retry this page or select another endpoint.'
    );
    this.name = 'RepeatedDepositCursor';
  }
}

const isClosedProposal = computed(() =>
  Boolean(
    props.proposalStatus &&
      props.proposalStatus !== 'PROPOSAL_STATUS_DEPOSIT_PERIOD' &&
      props.proposalStatus !== 'PROPOSAL_STATUS_VOTING_PERIOD'
  )
);
const hasNext = computed(() => Boolean(nextKey.value));

async function loadPage(index: number) {
  const req = ++generation;
  const page = new PageRequest();
  page.setPageSize(pageSize);
  page.count_total = false;
  page.key = cursors.value[index];

  current.value = index;
  rows.value = [];
  nextKey.value = '';
  error.value = '';
  loading.value = true;
  historicalEvents.value = [];
  historicalUnavailableReason.value = '';

  try {
    const res = await govStore.fetchProposalDeposits(props.proposalId, page);
    if (req !== generation) return;
    const next = res?.pagination?.next_key || '';
    if (next && cursors.value.slice(0, index + 1).includes(next)) {
      throw new RepeatedDepositCursor();
    }
    const list = Array.isArray(res?.deposits)
      ? res.deposits
      : res?.deposits
        ? [res.deposits as unknown as GovDeposit]
        : [];
    rows.value = list;
    nextKey.value = next;

    if (isClosedProposal.value && list.length === 0) {
      const recon = reconstructClosedProposalDeposits({
        proposalId: props.proposalId,
        startHeight: 0,
        endHeight: -1,
        coveredHeights: [],
        txs: [],
        indexComplete: false,
        indexError:
          'Full historical deposit transaction & block timestamp evidence from submit to deposit-end is unavailable on this node without archive indexing.',
      });
      historicalUnavailableReason.value = recon.reason;
    }
  } catch (cause) {
    if (req !== generation) return;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (req === generation) loading.value = false;
  }
}

function nextPage() {
  if (loading.value || !nextKey.value) return;
  cursors.value = [...cursors.value.slice(0, current.value + 1), nextKey.value];
  void loadPage(current.value + 1);
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
    cursors.value = [undefined];
    current.value = 0;
    rows.value = [];
    nextKey.value = '';
    error.value = '';
    loading.value = Boolean(props.proposalId);
    await nextTick();
    if (reset !== generation) return;
    if (props.proposalId && blockchain.chainName === props.chain) {
      void loadPage(0);
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
    aria-labelledby="proposal-deposits-heading"
    data-proposal-deposits
  >
    <h2 id="proposal-deposits-heading" class="card-title mb-1">Deposits</h2>
    <p class="text-xs text-base-content/70 mb-3">
      Current deposit totals per depositor reported by the node (deposit timestamps are not included in current REST state).
    </p>
    <div :aria-busy="loading">
      <p v-if="loading" role="status" class="py-3 text-sm">
        Loading deposits...
      </p>
      <div v-else-if="error" role="alert" class="py-3 text-sm text-error">
        Could not load deposits page {{ current + 1 }}. {{ error }}
        <button type="button" class="btn btn-xs ml-2" @click="loadPage(current)">
          Retry
        </button>
      </div>
      <template v-else>
        <div
          v-if="!rows.length"
          role="status"
          class="py-3 text-sm text-base-content/80"
        >
          <template v-if="isClosedProposal">
            No current deposit state returned by the node for this closed proposal (this does not indicate zero historical deposits).
            <span v-if="historicalUnavailableReason" class="block text-xs mt-1 text-base-content/60">
              Historical deposit events unavailable: {{ historicalUnavailableReason }}
            </span>
          </template>
          <template v-else>
            {{
              current === 0 && !hasNext
                ? 'No deposits found for this proposal.'
                : 'No deposits on this page.'
            }}
          </template>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="table w-full table-zebra text-sm">
            <thead>
              <tr>
                <th>Depositor</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in rows" :key="`${item.depositor}-${idx}`">
                <td>
                  <RouterLink
                    class="text-primary underline underline-offset-4"
                    :to="`/${chain}/account/${item.depositor}`"
                  >
                    {{ item.depositor }}
                  </RouterLink>
                </td>
                <td class="tabular-nums">
                  {{ format.formatTokens(item.amount, true, '0,0.[00]') || '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
    <nav
      v-if="!loading && !error && (rows.length > 0 || current > 0)"
      aria-label="Proposal deposit pages"
      class="mt-3 flex flex-wrap items-center gap-3"
    >
      <button
        class="btn btn-xs"
        type="button"
        :disabled="loading || current === 0"
        @click="loadPage(current - 1)"
      >
        Previous
      </button>
      <span class="tabular-nums text-xs">Page {{ current + 1 }}</span>
      <button
        class="btn btn-xs"
        type="button"
        :disabled="loading || !hasNext"
        @click="nextPage"
      >
        Next
      </button>
    </nav>
  </section>
</template>
