<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';
import { PageRequest, type UnbondingResponses } from '@/types';

interface UnbondingRow {
  key: string;
  delegator_address: string;
  balance: string;
  completion_time: string;
}

const props = defineProps<{ validator: string; chain: string; embedded?: boolean }>();
const blockchain = useBlockchain();
const staking = useStakingStore();
const format = useFormatter();
const pageSize = 10;
const rows = ref<UnbondingRow[]>([]);
const loading = ref(false);
const error = ref('');
const current = ref(0);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextKey = ref('');
let generation = 0;

class RepeatedUnbondingCursor extends Error {
  constructor() {
    super(
      'The node returned a repeated page cursor. Retry this page or select another endpoint.'
    );
    this.name = 'RepeatedUnbondingCursor';
  }
}

const hasNext = computed(() => Boolean(nextKey.value));
const bondDenom = computed(
  () =>
    staking.params?.bond_denom ||
    blockchain.current?.assets?.[0]?.base ||
    ''
);

function flattenEntries(responses?: UnbondingResponses[]): UnbondingRow[] {
  if (!Array.isArray(responses)) return [];
  const flattened: UnbondingRow[] = [];
  for (const item of responses) {
    if (!item || !Array.isArray(item.entries)) continue;
    const delegator = item.delegator_address || '';
    item.entries.forEach((entry, entryIndex) => {
      if (!entry) return;
      const suffix =
        entry.unbonding_id ??
        `${entry.creation_height || ''}-${entry.completion_time || ''}-${entryIndex}`;
      flattened.push({
        key: `${delegator}-${suffix}`,
        delegator_address: delegator,
        balance: entry.balance || '',
        completion_time: entry.completion_time || '',
      });
    });
  }
  return flattened;
}

function formatBalance(amount?: string) {
  if (!amount) return '-';
  if (!bondDenom.value) return amount;
  return format.formatToken({ amount, denom: bondDenom.value });
}

function hasValidCompletionTime(value?: string) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function formatCompletionTime(value?: string) {
  if (!hasValidCompletionTime(value)) return '-';
  return format.toDay(value, 'short');
}

async function loadPage(index: number) {
  const request = ++generation;
  const client = blockchain.rpc;
  const validator = props.validator;
  const page = new PageRequest();
  page.setPageSize(pageSize);
  page.count_total = false;
  page.key = cursors.value[index];
  current.value = index;
  nextKey.value = '';
  error.value = '';
  loading.value = true;

  try {
    const response = await client.getStakingValidatorsUnbondings(
      validator,
      page
    );
    if (request !== generation) return;
    const next = response.pagination?.next_key || '';
    if (next && cursors.value.slice(0, index + 1).includes(next)) {
      throw new RepeatedUnbondingCursor();
    }
    rows.value = flattenEntries(response.unbonding_responses);
    nextKey.value = next;
  } catch (cause) {
    if (request !== generation) return;
    rows.value = [];
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (request === generation) loading.value = false;
  }
}

function nextPage() {
  if (loading.value || !nextKey.value) return;
  cursors.value = [...cursors.value.slice(0, current.value + 1), nextKey.value];
  loadPage(current.value + 1);
}

watch(
  () => [
    props.validator,
    props.chain,
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
    loading.value = Boolean(props.validator);
    // Endpoint state is assigned before the client in setRestEndpoint.
    // Invalidate synchronously, then read the new client after that action finishes.
    await nextTick();
    if (reset !== generation) return;
    if (
      props.validator &&
      blockchain.chainName === props.chain &&
      blockchain.rpc?.endpoint
    ) {
      loadPage(0);
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
    :class="embedded ? 'pt-2' : 'mt-5 bg-base-100 shadow rounded p-4'"
    aria-labelledby="unbondings-heading"
    data-validator-unbondings
  >
    <h2
      id="unbondings-heading"
      :class="embedded ? 'sr-only' : 'text-lg font-semibold'"
    >
      {{ $t('account.unbonding_delegations') }}
    </h2>
    <p class="text-sm text-base-content/70 mt-1" :class="embedded ? 'mb-2' : 'mb-4'">
      Active unbonding entries currently in progress.
    </p>
    <div :aria-busy="loading">
      <div v-if="error" role="alert" class="py-4">
        <p>
          Could not load unbonding delegations page {{ current + 1 }}.
          {{ error }}
        </p>
        <button
          class="btn btn-sm unbonding-primary mt-4"
          type="button"
          @click="loadPage(current)"
        >
          Retry
        </button>
      </div>
      <p v-else-if="loading && !rows.length" role="status" class="py-4">
        Loading unbonding delegations...
      </p>
      <template v-else>
        <p v-if="!rows.length" role="status" class="py-4">
          {{
            current === 0 && !hasNext
              ? 'No active unbonding delegations found.'
              : 'No active unbonding delegations on this page.'
          }}
        </p>
        <table
          v-else
          class="table w-full unbonding-table transition-opacity"
          :class="{ 'opacity-60 pointer-events-none': loading }"
        >
          <thead>
            <tr>
              <th scope="col" class="text-base-content">
                {{ $t('account.delegator') }}
              </th>
              <th scope="col" class="text-base-content">
                {{ $t('account.balance') }}
              </th>
              <th scope="col" class="text-base-content">
                {{ $t('account.completion_time') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <td>
                <RouterLink
                  v-if="row.delegator_address"
                  class="text-base-content underline underline-offset-4"
                  :to="`/${chain}/account/${row.delegator_address}`"
                >
                  {{ row.delegator_address }}
                </RouterLink>
                <span v-else>-</span>
              </td>
              <td>{{ formatBalance(row.balance) }}</td>
              <td>
                <time
                  v-if="hasValidCompletionTime(row.completion_time)"
                  :datetime="row.completion_time"
                >
                  {{ formatCompletionTime(row.completion_time) }}
                </time>
                <span v-else>-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
    <nav
      aria-label="Unbonding delegation pages"
      class="mt-4 flex flex-wrap items-center gap-3"
    >
      <button
        class="btn btn-sm"
        type="button"
        :disabled="loading || current === 0"
        @click="loadPage(current - 1)"
      >
        Previous
      </button>
      <span class="tabular-nums inline-flex items-center gap-2" aria-live="polite"
        >Page {{ current + 1
        }}<span
          v-if="loading && rows.length"
          class="loading loading-spinner loading-xs"
          aria-hidden="true"
        ></span
      ></span>
      <button
        class="btn btn-sm"
        :class="{ 'unbonding-primary': !error }"
        type="button"
        :disabled="loading || !hasNext"
        @click="nextPage"
      >
        Next
      </button>
    </nav>
  </section>
</template>

<style scoped>
.unbonding-table {
  table-layout: fixed;
}
.unbonding-table :where(th, td) {
  padding: 0.6rem 1rem;
  font-size: 14px;
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: middle;
}
.unbonding-table th:first-child {
  width: 50%;
}
.unbonding-table td {
  font-variant-numeric: tabular-nums;
}
.unbonding-primary {
  background-color: hsl(var(--bc));
  color: hsl(var(--b1));
}
.unbonding-primary:hover {
  background-color: hsl(var(--bc) / 0.9);
}
button:disabled {
  background-color: hsl(var(--b2));
  color: hsl(var(--bc));
}
a:focus-visible,
button:focus-visible {
  outline: 2px solid hsl(var(--bc));
  outline-offset: 2px;
}
</style>
