<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';
import { queryValidatorRedelegations, resolveRpcEndpoint } from '@/libs/abci';
import { PageRequest, type Redelegation } from '@/types';

interface RedelegationRow {
  key: string;
  delegator_address: string;
  validator_dst_address: string;
  balance: string;
  completion_time: string;
}

const props = defineProps<{ validator: string; chain: string; embedded?: boolean }>();
const blockchain = useBlockchain();
const staking = useStakingStore();
const format = useFormatter();
const pageSize = 10;
const rows = ref<RedelegationRow[]>([]);
const loading = ref(false);
const error = ref('');
const current = ref(0);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextKey = ref('');
let generation = 0;

class RepeatedRedelegationCursor extends Error {
  constructor() {
    super(
      'The node returned a repeated page cursor. Retry this page or select another endpoint.'
    );
    this.name = 'RepeatedRedelegationCursor';
  }
}

const hasNext = computed(() => Boolean(nextKey.value));
const rpcEndpoint = computed(() => resolveRpcEndpoint(blockchain.current));
const bondDenom = computed(
  () =>
    staking.params?.bond_denom ||
    blockchain.current?.assets?.[0]?.base ||
    ''
);

function flattenEntries(responses?: Redelegation[]): RedelegationRow[] {
  if (!Array.isArray(responses)) return [];
  const flattened: RedelegationRow[] = [];
  for (const item of responses) {
    if (!item || !Array.isArray(item.entries)) continue;
    const delegator = item.redelegation?.delegator_address || '';
    const dstValidator = item.redelegation?.validator_dst_address || '';
    item.entries.forEach((entry, entryIndex) => {
      if (!entry) return;
      const meta = entry.redelegation_entry;
      flattened.push({
        key: `${delegator}-${dstValidator}-${meta?.creation_height || ''}-${meta?.completion_time || ''}-${entryIndex}`,
        delegator_address: delegator,
        validator_dst_address: dstValidator,
        balance: entry.balance || '',
        completion_time: meta?.completion_time || '',
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
  const validator = props.validator;
  const rpc = rpcEndpoint.value;
  const page = new PageRequest();
  page.setPageSize(pageSize);
  page.count_total = false;
  page.key = cursors.value[index];
  current.value = index;
  nextKey.value = '';
  error.value = '';
  loading.value = true;

  try {
    const response = await queryValidatorRedelegations(rpc, validator, page);
    if (request !== generation) return;
    const next = response.pagination?.next_key || '';
    if (next && cursors.value.slice(0, index + 1).includes(next)) {
      throw new RepeatedRedelegationCursor();
    }
    rows.value = flattenEntries(response.redelegation_responses);
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
    rpcEndpoint.value,
  ],
  async () => {
    const reset = ++generation;
    cursors.value = [undefined];
    current.value = 0;
    rows.value = [];
    nextKey.value = '';
    error.value = '';
    loading.value = Boolean(props.validator);
    await nextTick();
    if (reset !== generation) return;
    if (!props.validator) {
      loading.value = false;
      return;
    }
    if (blockchain.chainName === props.chain) {
      if (!rpcEndpoint.value) {
        error.value = 'No RPC endpoint is configured for this chain.';
        loading.value = false;
        return;
      }
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
    aria-labelledby="redelegations-heading"
    data-validator-redelegations
  >
    <h2
      id="redelegations-heading"
      :class="embedded ? 'sr-only' : 'text-lg font-semibold'"
    >
      Outgoing Redelegations
    </h2>
    <p class="text-sm text-base-content/70 mt-1" :class="embedded ? 'mb-2' : 'mb-4'">
      Active redelegation entries originating from this validator.
    </p>
    <div :aria-busy="loading">
      <div v-if="error" role="alert" class="py-4">
        <p>
          Could not load outgoing redelegations page {{ current + 1 }}.
          {{ error }}
        </p>
        <button
          class="btn btn-sm redelegation-primary mt-4"
          type="button"
          @click="loadPage(current)"
        >
          Retry
        </button>
      </div>
      <p v-else-if="loading && !rows.length" role="status" class="py-4">
        Loading outgoing redelegations...
      </p>
      <template v-else>
        <p v-if="!rows.length" role="status" class="py-4">
          {{
            current === 0 && !hasNext
              ? 'No active outgoing redelegations found.'
              : 'No active outgoing redelegations on this page.'
          }}
        </p>
        <table
          v-else
          class="table w-full redelegation-table transition-opacity"
          :class="{ 'opacity-60 pointer-events-none': loading }"
        >
          <thead>
            <tr>
              <th scope="col" class="text-base-content">
                {{ $t('account.delegator') }}
              </th>
              <th scope="col" class="text-base-content">
                Destination Validator
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
              <td>
                <RouterLink
                  v-if="row.validator_dst_address"
                  class="text-base-content underline underline-offset-4"
                  :to="`/${chain}/staking/${row.validator_dst_address}`"
                >
                  {{ row.validator_dst_address }}
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
      aria-label="Outgoing redelegation pages"
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
        :class="{ 'redelegation-primary': !error }"
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
.redelegation-table {
  table-layout: fixed;
}
.redelegation-table :where(th, td) {
  padding: 0.6rem 1rem;
  font-size: 14px;
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: middle;
}
.redelegation-table td {
  font-variant-numeric: tabular-nums;
}
.redelegation-primary {
  background-color: hsl(var(--bc));
  color: hsl(var(--b1));
}
.redelegation-primary:hover {
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
