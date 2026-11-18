<!-- Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBaseStore, useBlockchain, useFormatter } from '@/stores';
import { useRouter } from 'vue-router';

type TxDisplayMode = 'compact' | 'detailed';
const TX_DISPLAY_KEY = 'explorer:txDisplayMode';

function readStoredTxDisplayMode(): TxDisplayMode {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(TX_DISPLAY_KEY)
        : null;
    return raw === 'compact' || raw === 'detailed' ? raw : 'compact';
  } catch {
    return 'compact';
  }
}

const props = defineProps(['chain']);
const vueRouters = useRouter();
const tab = ref('recent');
const displayMode = ref<TxDisplayMode>(readStoredTxDisplayMode());

const base = useBaseStore();
const chainStore = useBlockchain();
const format = useFormatter();

const hashReg = /^[A-Fa-f\d]{64}$/;
const hash = ref('');

onMounted(() => {
  const qTab = vueRouters?.currentRoute?.value?.query?.tab;
  tab.value = String(qTab || 'recent');
});

function setDisplayMode(mode: TxDisplayMode) {
  displayMode.value = mode === 'detailed' ? 'detailed' : 'compact';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TX_DISPLAY_KEY, displayMode.value);
    }
  } catch {
    // ignore storage errors
  }
}

function search() {
  const trimmed = hash.value.trim();
  const targetChain =
    props.chain || chainStore?.current?.chainName || chainStore.chainName || '';
  if (hashReg.test(trimmed)) {
    vueRouters.push({ path: `/${targetChain}/tx/${trimmed.toUpperCase()}` });
  }
}

const recentTxs = computed(() => {
  if (chainStore.chainName && props.chain && chainStore.chainName !== props.chain) {
    return [];
  }
  return base.txsInRecents || [];
});

function formatMessageTypes(msgs?: { '@type'?: string; typeUrl?: string }[]) {
  if (!Array.isArray(msgs) || msgs.length === 0) return '-';
  return msgs
    .map((m) => {
      const raw = m['@type'] || m.typeUrl || 'unknown';
      return raw.substring(raw.lastIndexOf('.') + 1);
    })
    .join(', ');
}
</script>
<template>
  <div>
    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
      <div class="tabs tabs-boxed bg-transparent">
        <a
          class="tab text-gray-400 uppercase"
          :class="{ 'tab-active': tab === 'recent' }"
          @click="tab = 'recent'"
          >{{ $t('block.recent') }}</a
        >
        <a
          class="tab text-gray-400 uppercase"
          :class="{ 'tab-active': tab === 'search' }"
          @click="tab = 'search'"
          >Search</a
        >
      </div>

      <div
        v-show="tab === 'recent'"
        class="btn-group"
        role="group"
        aria-label="Transaction list display mode"
      >
        <button
          type="button"
          class="btn btn-xs"
          :class="{ 'btn-active': displayMode === 'compact' }"
          @click="setDisplayMode('compact')"
        >
          Compact
        </button>
        <button
          type="button"
          class="btn btn-xs"
          :class="{ 'btn-active': displayMode === 'detailed' }"
          @click="setDisplayMode('detailed')"
        >
          Detailed
        </button>
      </div>
    </div>

    <div v-show="tab === 'recent'" class="bg-base-100 rounded overflow-x-auto">
      <table v-if="displayMode === 'compact'" class="table w-full table-compact">
        <thead class="bg-base-200">
          <tr>
            <th style="position: relative; z-index: 2">{{ $t('account.height') }}</th>
            <th style="position: relative; z-index: 2">{{ $t('account.hash') }}</th>
            <th>{{ $t('account.messages') }}</th>
            <th>{{ $t('block.fees') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!recentTxs.length">
            <td colspan="4" class="text-center py-6 text-sm text-base-content/70">
              No recent cached transactions.
            </td>
          </tr>
          <tr v-for="(item, index) in recentTxs" :key="`${item.height}-${item.hash}-${index}`" class="hover">
            <td class="text-sm text-primary">
              <RouterLink :to="`/${props.chain}/block/${item.height}`">{{ item.height }}</RouterLink>
            </td>
            <td class="truncate text-primary" width="50%">
              <RouterLink :to="`/${props.chain}/tx/${item.hash}`">{{ item.hash }}</RouterLink>
            </td>
            <td>{{ format.messages(item.tx.body.messages) }}</td>
            <td>{{ format.formatTokens(item.tx.authInfo.fee?.amount) }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="table w-full table-compact">
        <thead class="bg-base-200">
          <tr>
            <th>{{ $t('account.height') }}</th>
            <th>{{ $t('account.hash') }}</th>
            <th>{{ $t('account.messages') }}</th>
            <th>Signers / Gas Limit</th>
            <th>{{ $t('block.fees') }}</th>
            <th>{{ $t('tx.memo') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!recentTxs.length">
            <td colspan="6" class="text-center py-6 text-sm text-base-content/70">
              No recent cached transactions.
            </td>
          </tr>
          <tr v-for="(item, index) in recentTxs" :key="`${item.height}-${item.hash}-${index}`" class="hover">
            <td class="text-sm text-primary align-top">
              <RouterLink :to="`/${props.chain}/block/${item.height}`">{{ item.height }}</RouterLink>
            </td>
            <td class="font-mono text-xs text-primary break-all align-top">
              <RouterLink :to="`/${props.chain}/tx/${item.hash}`">{{ item.hash }}</RouterLink>
            </td>
            <td class="text-xs align-top">
              <div class="font-medium">{{ format.messages(item.tx.body.messages) }}</div>
              <div class="text-base-content/70">
                {{ formatMessageTypes(item.tx.body.messages) }}
              </div>
            </td>
            <td class="text-xs tabular-nums align-top">
              <div>Signers: {{ item.tx.authInfo?.signerInfos?.length ?? 0 }}</div>
              <div>Gas Limit: {{ item.tx.authInfo?.fee?.gasLimit?.toString() || '-' }}</div>
            </td>
            <td class="text-xs tabular-nums align-top">
              {{ format.formatTokens(item.tx.authInfo.fee?.amount) || '-' }}
            </td>
            <td class="text-xs break-all align-top">
              {{ item.tx.body?.memo || '-' }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="p-4">
        <div class="alert relative bg-transparent">
          <div class="alert absolute inset-x-0 inset-y-0 w-full h-full bg-info opacity-10"></div>
          <div class="text-info flex gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="stroke-current flex-shrink-0 w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span>
              {{ $t('block.only_tx') }}
              <template v-if="!base.fetchAllBlocks">
                (Sampling mode: intermediate blocks between polls are not
                backfilled.)
              </template>
              <template v-else-if="base.missingHeights.length > 0">
                (Incomplete recent window: missing block height(s)
                {{ base.missingHeights.join(', ') }}.)
              </template>
              <template v-else-if="base.isContiguous">
                (Contiguous within recent {{ base.windowLimit }}-block window.)
              </template>
              Status and execution timestamp are available on each transaction's detail page.
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-show="tab === 'search'" class="bg-base-100 rounded overflow-x-auto">
      <div class="p-4">
        <div class="form-control">
          <input
            v-model="hash"
            type="text"
            class="input input-bordered"
            placeholder="Search by Tx Hash"
            @blur="search"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<route>
    {
      meta: {
        i18n: 'tx',
        order: 5
      }
    }
  </route>
