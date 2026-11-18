<!-- Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { useBlockchain, useFormatter } from '@/stores';
import DynamicComponent from '@/components/dynamic/DynamicComponent.vue';
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { Tx, TxResponse } from '@/types';
import {
  buildMessageFilterOptions,
  filterTxMessages,
  normalizeTxEvents,
  normalizeTxLogs,
  normalizeTxMessages,
} from '@/libs/txDetail';
import JsonTree from '@/components/JsonTree.vue';
import { useRouter } from 'vue-router';

const props = defineProps(['hash', 'chain']);
const router = useRouter();
const searchHash = ref('');
const searchError = ref('');
const hashPattern = /^[A-Fa-f\d]{64}$/;

const blockchain = useBlockchain();
const format = useFormatter();
const tx = ref(
  {} as {
    tx: Tx;
    tx_response: TxResponse;
  }
);
const loading = ref(false);
const loadError = ref('');
const selectedMessageType = ref('all');
const messageViewMode = ref<'structured' | 'raw'>('structured');
const logsViewMode = ref<'structured' | 'raw'>('structured');
const eventsViewMode = ref<'structured' | 'raw'>('structured');
let generation = 0;

async function loadTransaction(hash: string) {
  const req = ++generation;
  tx.value = {} as { tx: Tx; tx_response: TxResponse };
  loadError.value = '';
  loading.value = true;
  selectedMessageType.value = 'all';
  messageViewMode.value = 'structured';
  logsViewMode.value = 'structured';
  eventsViewMode.value = 'structured';

  try {
    const result = await blockchain.rpc.getTx(hash);
    if (req !== generation) return;
    tx.value = result;
  } catch (cause) {
    if (req !== generation) return;
    loadError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (req === generation) loading.value = false;
  }
}

watch(
  () => [props.hash, props.chain, blockchain.chainName, blockchain.endpoint.address],
  ([hash]) => {
    if (hash) {
      void loadTransaction(String(hash));
    } else {
      ++generation;
      tx.value = {} as { tx: Tx; tx_response: TxResponse };
    }
  },
  { immediate: true }
);

onScopeDispose(() => {
  ++generation;
});

function search() {
  const value = searchHash.value.trim();
  if (!hashPattern.test(value)) {
    searchError.value = 'Enter a valid 64-character transaction hash.';
    return;
  }
  searchError.value = '';
  router.push(`/${props.chain}/tx/${value.toUpperCase()}`);
}

const normalizedMessages = computed(() =>
  normalizeTxMessages(tx.value.tx?.body?.messages, (v) =>
    format.base64ToString(v)
  )
);

const messageFilterOptions = computed(() =>
  buildMessageFilterOptions(normalizedMessages.value)
);

const filteredMessages = computed(() =>
  filterTxMessages(normalizedMessages.value, selectedMessageType.value)
);

const txLogs = computed(() => normalizeTxLogs(tx.value.tx_response?.logs));
const txEvents = computed(() => normalizeTxEvents(tx.value.tx_response?.events));
const rawLogText = computed(() =>
  typeof tx.value.tx_response?.raw_log === 'string'
    ? tx.value.tx_response.raw_log
    : tx.value.tx_response?.raw_log != null
      ? JSON.stringify(tx.value.tx_response.raw_log)
      : ''
);
</script>
<template>
  <div>
    <form class="mb-4" role="search" @submit.prevent="search">
      <div class="join flex w-full">
        <input
          v-model="searchHash"
          type="text"
          class="input join-item input-sm h-10 min-w-0 flex-1 border border-base-300 bg-base-100 px-4 focus:border-primary"
          placeholder="Enter transaction hash"
          aria-label="Transaction hash"
          @input="searchError = ''"
        />
        <button type="submit" class="btn btn-primary join-item !h-10 !min-h-10 py-0">
          Search
        </button>
      </div>
      <p v-if="searchError" class="mt-2 text-sm text-error">{{ searchError }}</p>
    </form>

    <p v-if="loading" role="status" class="py-4 text-sm">
      Loading transaction...
    </p>
    <div v-else-if="loadError" role="alert" class="alert alert-error mb-4 text-sm">
      <span>Could not load transaction {{ hash }}. {{ loadError }}</span>
    </div>

    <div v-if="tx.tx_response" class="bg-base-100 px-4 pt-3 pb-4 rounded shadow mb-4">
      <h2 class="card-title truncate mb-2">{{ $t('tx.title') }}</h2>
      <div class="overflow-hidden">
        <table class="table text-sm">
          <tbody>
            <tr>
              <td>{{ $t('tx.tx_hash') }}</td>
              <td class="overflow-hidden">{{ tx.tx_response.txhash }}</td>
            </tr>
            <tr>
              <td>{{ $t('account.height') }}</td>
              <td>
                <RouterLink :to="`/${props.chain}/block/${tx.tx_response.height}`" class="text-primary">
                  {{ tx.tx_response.height }}
                </RouterLink>
              </td>
            </tr>
            <tr>
              <td>{{ $t('staking.status') }}</td>
              <td>
                <span
                  class="text-xs truncate relative py-2 px-4 w-fit mr-2 rounded"
                  :class="`text-${tx.tx_response.code === 0 ? 'success' : 'error'}`"
                >
                  <span
                    class="inset-x-0 inset-y-0 opacity-10 absolute"
                    :class="`bg-${tx.tx_response.code === 0 ? 'success' : 'error'}`"
                  ></span>
                  {{ tx.tx_response.code === 0 ? 'Success' : 'Failed' }}
                </span>
                <span>
                  {{ tx.tx_response.code === 0 ? '' : rawLogText }}
                </span>
              </td>
            </tr>
            <tr>
              <td>{{ $t('account.time') }}</td>
              <td>
                {{ format.toLocaleDate(tx.tx_response.timestamp) }} ({{
                  format.toDay(tx.tx_response.timestamp, 'from')
                }})
              </td>
            </tr>
            <tr>
              <td>{{ $t('tx.gas') }}</td>
              <td>{{ tx.tx_response.gas_used }} / {{ tx.tx_response.gas_wanted }}</td>
            </tr>
            <tr>
              <td>{{ $t('tx.fee') }}</td>
              <td>
                {{ format.formatTokens(tx.tx?.auth_info?.fee?.amount, true, '0,0.[00]') }}
              </td>
            </tr>
            <tr>
              <td>{{ $t('tx.memo') }}</td>
              <td>{{ tx.tx?.body?.memo }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div
      v-if="tx.tx_response"
      class="bg-base-100 px-4 pt-3 pb-4 rounded shadow mb-4"
      data-tx-messages
    >
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="card-title truncate">
          {{ $t('account.messages') }}: ({{ filteredMessages.length }}/{{ normalizedMessages.length }})
        </h2>
        <div class="flex flex-wrap items-center gap-2">
          <select
            v-if="normalizedMessages.length > 0"
            v-model="selectedMessageType"
            aria-label="Filter messages by type"
            class="select select-bordered select-sm"
          >
            <option
              v-for="opt in messageFilterOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }} ({{ opt.count }})
            </option>
          </select>
          <div class="btn-group">
            <button
              type="button"
              class="btn btn-xs"
              :class="{ 'btn-active': messageViewMode === 'structured' }"
              @click="messageViewMode = 'structured'"
            >
              Structured
            </button>
            <button
              type="button"
              class="btn btn-xs"
              :class="{ 'btn-active': messageViewMode === 'raw' }"
              @click="messageViewMode = 'raw'"
            >
              Raw
            </button>
          </div>
        </div>
      </div>

      <div v-if="normalizedMessages.length === 0" class="py-2 text-sm">
        {{ $t('tx.no_messages') }}
      </div>
      <div v-else-if="filteredMessages.length === 0" class="py-2 text-sm">
        No messages match the selected filter.
      </div>
      <div v-else v-for="msg in filteredMessages" :key="msg.index">
        <div class="border border-slate-400 rounded-md mt-4 p-2">
          <div class="text-xs text-base-content/70 mb-2 flex flex-wrap gap-2">
            <span>#{{ msg.index + 1 }} {{ msg.shortType }}</span>
            <span v-if="msg.nestedTypes.length > 0">
              (nested: {{ msg.nestedTypes.join(', ') }})
            </span>
          </div>
          <DynamicComponent
            v-if="messageViewMode === 'structured'"
            :value="msg.display"
          />
          <pre
            v-else
            class="text-xs overflow-x-auto whitespace-pre-wrap break-all"
          >{{ JSON.stringify(msg.raw, null, 2) }}</pre>
        </div>
      </div>
    </div>

    <div
      v-if="tx.tx_response"
      class="bg-base-100 px-4 pt-3 pb-4 rounded shadow mb-4"
      data-tx-logs
    >
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="card-title truncate">Logs ({{ txLogs.length }})</h2>
        <div class="btn-group">
          <button
            type="button"
            class="btn btn-xs"
            :class="{ 'btn-active': logsViewMode === 'structured' }"
            @click="logsViewMode = 'structured'"
          >
            Structured Logs
          </button>
          <button
            type="button"
            class="btn btn-xs"
            :class="{ 'btn-active': logsViewMode === 'raw' }"
            @click="logsViewMode = 'raw'"
          >
            Raw Logs
          </button>
        </div>
      </div>

      <pre
        v-if="logsViewMode === 'raw'"
        class="text-xs overflow-x-auto whitespace-pre-wrap break-all"
      >{{ JSON.stringify({ logs: tx.tx_response.logs ?? null, raw_log: rawLogText }, null, 2) }}</pre>
      <template v-else>
        <div
          v-if="tx.tx_response.code !== 0 && rawLogText && txLogs.length === 0"
          role="alert"
          class="alert alert-error text-xs py-2"
        >
          <span>Execution failed raw_log: {{ rawLogText }}</span>
        </div>
        <p v-else-if="txLogs.length === 0" role="status" class="text-sm py-2">
          No structured message logs were provided by the node.
          <template v-if="rawLogText"> raw_log: {{ rawLogText }}</template>
        </p>
        <div v-else class="space-y-3">
          <div
            v-for="entry in txLogs"
            :key="entry.msg_index"
            class="border border-base-300 rounded p-3 text-sm"
          >
            <div class="font-semibold mb-1">Message #{{ entry.msg_index }}</div>
            <p v-if="entry.log" class="text-xs mb-2 break-all">{{ entry.log }}</p>
            <div v-if="entry.events.length > 0" class="space-y-2">
              <div
                v-for="(ev, evIdx) in entry.events"
                :key="`${entry.msg_index}-${ev.type}-${evIdx}`"
                class="bg-base-200 rounded p-2 text-xs"
              >
                <div class="font-medium mb-1">{{ ev.type }}</div>
                <div
                  v-for="(attr, aIdx) in ev.attributes"
                  :key="aIdx"
                  class="flex flex-wrap gap-2"
                >
                  <span class="font-mono">{{ attr.key }}:</span>
                  <span class="font-mono break-all">{{ attr.value }}</span>
                </div>
              </div>
            </div>
            <p v-else class="text-xs text-base-content/70">No events in this log entry.</p>
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="tx.tx_response"
      class="bg-base-100 px-4 pt-3 pb-4 rounded shadow mb-4"
      data-tx-events
    >
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="card-title truncate">Events ({{ txEvents.length }})</h2>
        <div class="btn-group">
          <button
            type="button"
            class="btn btn-xs"
            :class="{ 'btn-active': eventsViewMode === 'structured' }"
            @click="eventsViewMode = 'structured'"
          >
            Structured Events
          </button>
          <button
            type="button"
            class="btn btn-xs"
            :class="{ 'btn-active': eventsViewMode === 'raw' }"
            @click="eventsViewMode = 'raw'"
          >
            Raw Events
          </button>
        </div>
      </div>

      <pre
        v-if="eventsViewMode === 'raw'"
        class="text-xs overflow-x-auto whitespace-pre-wrap break-all"
      >{{ JSON.stringify(tx.tx_response.events ?? null, null, 2) }}</pre>
      <template v-else>
        <p v-if="txEvents.length === 0" role="status" class="text-sm py-2">
          No events were provided in the transaction response.
        </p>
        <div v-else class="space-y-2">
          <div
            v-for="(ev, idx) in txEvents"
            :key="`${ev.type}-${idx}`"
            class="border border-base-300 rounded p-3 text-xs"
          >
            <div class="font-semibold mb-1">#{{ idx + 1 }} {{ ev.type }}</div>
            <div
              v-for="(attr, aIdx) in ev.attributes"
              :key="aIdx"
              class="flex flex-wrap gap-2"
            >
              <span class="font-mono">{{ attr.key }}:</span>
              <span class="font-mono break-all">{{ attr.value }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="tx.tx_response" class="bg-base-100 px-4 pt-3 pb-4 rounded shadow">
      <h2 class="card-title truncate mb-2">JSON</h2>
      <JsonTree :data="tx" :deep="2" :height="480" virtual />
    </div>
  </div>
</template>
