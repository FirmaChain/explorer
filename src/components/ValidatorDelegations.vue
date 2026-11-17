<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useBlockchain, useFormatter } from '@/stores';
import { PageRequest, type Delegation } from '@/types';

const props = defineProps<{ validator: string; chain: string; embedded?: boolean }>();
const blockchain = useBlockchain();
const format = useFormatter();
const pageSize = 10;
const rows = ref<Delegation[]>([]);
const loading = ref(false);
const error = ref('');
const current = ref(0);
const cursors = ref<(string | undefined)[]>([undefined]);
const nextKey = ref('');
let generation = 0;

class RepeatedDelegationCursor extends Error {
  constructor() {
    super(
      'The node returned a repeated page cursor. Retry this page or select another endpoint.'
    );
    this.name = 'RepeatedDelegationCursor';
  }
}

const hasNext = computed(() => Boolean(nextKey.value));

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
    const response = await client.getStakingValidatorsDelegations(
      validator,
      page
    );
    if (request !== generation) return;
    const next = response.pagination?.next_key || '';
    if (next && cursors.value.slice(0, index + 1).includes(next)) {
      throw new RepeatedDelegationCursor();
    }
    rows.value = response.delegation_responses;
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
    loading.value = true;
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
    aria-labelledby="delegations-heading"
    data-validator-delegations
  >
    <h2
      id="delegations-heading"
      :class="embedded ? 'sr-only' : 'text-lg mb-4 font-semibold'"
    >
      {{ $t('account.delegations') }}
    </h2>
    <div :aria-busy="loading">
      <div v-if="error" role="alert" class="py-4">
        <p>Could not load delegation page {{ current + 1 }}. {{ error }}</p>
        <button
          class="btn btn-sm delegation-primary mt-4"
          type="button"
          @click="loadPage(current)"
        >
          Retry
        </button>
      </div>
      <p v-else-if="loading && !rows.length" role="status" class="py-4">
        Loading delegations...
      </p>
      <template v-else>
        <p v-if="!rows.length" role="status" class="py-4">
          {{
            current === 0 && !hasNext
              ? 'No delegations found.'
              : 'No delegations on this page.'
          }}
        </p>
        <table
          v-else
          class="table w-full delegation-table transition-opacity"
          :class="{ 'opacity-60 pointer-events-none': loading }"
        >
          <thead>
            <tr>
              <th scope="col" class="text-base-content">
                {{ $t('account.delegator') }}
              </th>
              <th scope="col" class="text-base-content">
                {{ $t('account.delegation') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ balance, delegation } in rows"
              :key="delegation.delegator_address"
            >
              <td>
                <RouterLink
                  class="text-base-content underline underline-offset-4"
                  :to="`/${chain}/account/${delegation.delegator_address}`"
                >
                  {{ delegation.delegator_address }}
                </RouterLink>
              </td>
              <td>{{ format.formatToken(balance) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
    <nav
      aria-label="Delegation pages"
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
        :class="{ 'delegation-primary': !error }"
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
.delegation-table {
  table-layout: fixed;
}
.delegation-table :where(th, td) {
  padding: 0.6rem 1rem;
  font-size: 14px;
  white-space: normal;
  overflow-wrap: anywhere;
  vertical-align: middle;
}
.delegation-table th:first-child {
  width: 65%;
}
.delegation-table td {
  font-variant-numeric: tabular-nums;
}
.delegation-primary {
  background-color: hsl(var(--bc));
  color: hsl(var(--b1));
}
.delegation-primary:hover {
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
