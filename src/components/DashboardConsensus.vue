<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { consensusPubkeyToHexAddress } from '@/libs';
import { resolveRpcEndpoint } from '@/libs/abci';
import {
  fetchConsensusSnapshot,
  type ConsensusSnapshot,
} from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useStakingStore } from '@/stores';

const props = defineProps<{ chain: string }>();

const blockchain = useBlockchain();
const stakingStore = useStakingStore();
const baseStore = useBaseStore();

const loading = ref(false);
const snapshot = ref<ConsensusSnapshot | null>(null);
const error = ref('');
let generation = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let controller: AbortController | null = null;

const rpcEndpoint = computed(() => resolveRpcEndpoint(blockchain.current));

const validatorsWithHex = computed(() =>
  (stakingStore.validators || []).map((v) => ({
    ...v,
    consensus_hex: consensusPubkeyToHexAddress(v.consensus_pubkey),
  }))
);

function stopPolling() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
}

async function pollOnce() {
  const req = ++generation;
  const endpoint = rpcEndpoint.value;
  if (!endpoint) {
    snapshot.value = null;
    error.value = 'No RPC endpoint is configured for this chain.';
    loading.value = false;
    return;
  }
  if (controller) controller.abort();
  controller = new AbortController();
  if (!snapshot.value) loading.value = true;

  try {
    const next = await fetchConsensusSnapshot(
      endpoint,
      validatorsWithHex.value,
      controller.signal
    );
    if (req !== generation) return;
    snapshot.value = next;
    error.value = next.error;
  } catch (cause: any) {
    if (req !== generation || cause?.name === 'AbortError') return;
    snapshot.value = null;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (req === generation) loading.value = false;
  }
}

watch(
  () => [props.chain, blockchain.chainName, rpcEndpoint.value],
  async () => {
    stopPolling();
    const reset = ++generation;
    snapshot.value = null;
    error.value = '';
    loading.value = true;
    await nextTick();
    if (reset !== generation) return;
    if (blockchain.chainName === props.chain) {
      await pollOnce();
      if (reset !== generation) return;
      const interval = Math.max(2000, Math.round((baseStore.blocktime || 6000) / 2));
      timer = setInterval(() => {
        void pollOnce();
      }, interval);
    }
  },
  { immediate: true, flush: 'sync' }
);

onScopeDispose(() => {
  ++generation;
  stopPolling();
});
</script>

<template>
  <section
    class="bg-base-100 rounded mt-4 shadow p-4"
    aria-labelledby="dashboard-consensus-heading"
    data-dashboard-consensus
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 id="dashboard-consensus-heading" class="text-lg font-semibold text-main">
        Consensus State
      </h2>
      <RouterLink
        :to="`/${chain}/consensus`"
        class="text-sm link link-primary no-underline"
      >
        Details
      </RouterLink>
    </div>
    <p class="text-xs text-base-content/70 mb-3">
      Observed via periodic RPC polling (events between polls are not captured).
    </p>
    <p v-if="loading" role="status" class="text-sm py-2">
      Loading consensus state...
    </p>
    <div v-else-if="error" role="alert" class="text-sm text-error py-2">
      Consensus state unavailable: {{ error }}
      <button type="button" class="btn btn-xs ml-2" @click="pollOnce">
        Retry
      </button>
    </div>
    <div
      v-else-if="snapshot?.available"
      class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm"
    >
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Height</div>
        <div class="font-semibold tabular-nums">{{ snapshot.height }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Round</div>
        <div class="font-semibold tabular-nums">{{ snapshot.round }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Step</div>
        <div class="font-semibold tabular-nums">{{ snapshot.step }}</div>
      </div>
      <div class="bg-base-200 rounded p-3">
        <div class="text-xs text-base-content/70">Proposer</div>
        <div class="font-semibold truncate">
          {{ snapshot.proposerMoniker || snapshot.proposerHex || '-' }}
        </div>
      </div>
    </div>
  </section>
</template>
