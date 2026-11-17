<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter, useStakingStore } from '@/stores';
import { PageRequest, type Redelegation } from '@/types';

interface AccountRedelegationRow {
  key: string;
  validator_src_address: string;
  validator_dst_address: string;
  balance: string;
  completion_time: string;
}

const props = defineProps<{
  address: string;
  chain: string;
  refreshKey?: number;
}>();

const blockchain = useBlockchain();
const staking = useStakingStore();
const format = useFormatter();
const pageSize = 10;
const rows = ref<AccountRedelegationRow[]>([]);
const loading = ref(false);
const error = ref('');
const current = ref(0);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextKey = ref('');
let generation = 0;

class RepeatedAccountRedelegationCursor extends Error {
  constructor() {
    super(
      'The node returned a repeated page cursor. Retry this page or select another endpoint.'
    );
    this.name = 'RepeatedAccountRedelegationCursor';
  }
}

const hasNext = computed(() => Boolean(nextKey.value));
const bondDenom = computed(
  () =>
    staking.params?.bond_denom ||
    blockchain.current?.assets?.[0]?.base ||
    ''
);

function flattenEntries(responses?: Redelegation[]): AccountRedelegationRow[] {
  if (!Array.isArray(responses)) return [];
  const flattened: AccountRedelegationRow[] = [];
  for (const item of responses) {
    if (!item || !Array.isArray(item.entries)) continue;
    const src = item.redelegation?.validator_src_address || '';
    const dst = item.redelegation?.validator_dst_address || '';
    item.entries.forEach((entry, entryIndex) => {
      if (!entry) return;
      const meta = entry.redelegation_entry;
      flattened.push({
        key: `${src}-${dst}-${meta?.creation_height || ''}-${meta?.completion_time || ''}-${entryIndex}`,
        validator_src_address: src,
        validator_dst_address: dst,
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
  const client = blockchain.rpc;
  const address = props.address;
  const page = new PageRequest();
  page.setPageSize(pageSize);
  page.count_total = false;
  page.key = cursors.value[index];
  current.value = index;
  rows.value = [];
  nextKey.value = '';
  error.value = '';
  loading.value = true;

  try {
    const response = await client.getStakingDelegatorRedelegations(
      address,
      page
    );
    if (request !== generation) return;
    const next = response.pagination?.next_key || '';
    if (next && cursors.value.slice(0, index + 1).includes(next)) {
      throw new RepeatedAccountRedelegationCursor();
    }
    rows.value = flattenEntries(response.redelegation_responses);
    nextKey.value = next;
  } catch (cause) {
    if (request !== generation) return;
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
    props.address,
    props.chain,
    props.refreshKey,
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
    loading.value = Boolean(props.address);
    await nextTick();
    if (reset !== generation) return;
    if (!props.address) {
      loading.value = false;
      return;
    }
    if (blockchain.chainName === props.chain && blockchain.rpc?.endpoint) {
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
    class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow"
    aria-labelledby="account-redelegations-heading"
    data-account-redelegations
  >
    <h2 id="account-redelegations-heading" class="card-title">
      Active Redelegations
    </h2>
    <p class="text-sm text-base-content/70 mt-1 mb-4">
      In-progress redelegations for this account (current staking state, not
      completed history).
    </p>
    <div :aria-busy="loading" class="overflow-x-auto">
      <p v-if="loading" role="status" class="py-4">
        Loading active redelegations...
      </p>
      <div v-else-if="error" role="alert" class="py-4">
        <p>
          Could not load active redelegations page {{ current + 1 }}.
          {{ error }}
        </p>
        <button
          class="btn redelegation-primary mt-4"
          type="button"
          @click="loadPage(current)"
        >
          Retry
        </button>
      </div>
      <template v-else>
        <p v-if="!rows.length" role="status" class="py-4">
          {{
            current === 0 && !hasNext
              ? 'No active redelegations found.'
              : 'No active redelegations on this page.'
          }}
        </p>
        <table v-else class="table text-sm w-full account-redelegation-table">
          <thead>
            <tr>
              <th scope="col" class="py-3">Source Validator</th>
              <th scope="col" class="py-3">Destination Validator</th>
              <th scope="col" class="py-3">{{ $t('account.balance') }}</th>
              <th scope="col" class="py-3">
                {{ $t('account.completion_time') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.key">
              <td class="py-3">
                <RouterLink
                  v-if="row.validator_src_address"
                  class="text-primary underline underline-offset-4"
                  :to="`/${chain}/staking/${row.validator_src_address}`"
                >
                  {{ row.validator_src_address }}
                </RouterLink>
                <span v-else>-</span>
              </td>
              <td class="py-3">
                <RouterLink
                  v-if="row.validator_dst_address"
                  class="text-primary underline underline-offset-4"
                  :to="`/${chain}/staking/${row.validator_dst_address}`"
                >
                  {{ row.validator_dst_address }}
                </RouterLink>
                <span v-else>-</span>
              </td>
              <td class="py-3 tabular-nums">
                {{ formatBalance(row.balance) }}
              </td>
              <td class="py-3 tabular-nums">
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
      aria-label="Account redelegation pages"
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
      <span class="tabular-nums text-sm" aria-live="polite"
        >Page {{ current + 1 }}</span
      >
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
.account-redelegation-table :where(th, td) {
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.redelegation-primary {
  background-color: hsl(var(--bc));
  color: hsl(var(--b1));
}
</style>
