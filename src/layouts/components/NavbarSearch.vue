<!-- Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import { Icon } from '@iconify/vue';
import { onScopeDispose, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fromBech32, toHex } from '@cosmjs/encoding';
import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs';
import { fetchAllStakingValidators } from '@/libs/stakingConcentration';
import { useBlockchain, useStakingStore } from '@/stores';
import type { Validator } from '@/types';

const vueRouters = useRouter();
const blockStore = useBlockchain();
const stakingStore = useStakingStore();

const searchModalShow = ref(false);
const searchQuery = ref('');
const errorMessage = ref('');
const searching = ref(false);
let generation = 0;

function closeSearchModal() {
  searchModalShow.value = false;
}
function openSearchModal() {
  searchModalShow.value = true;
}

function stopClick(event: Event) {
  event.stopPropagation();
}
function selectValue(event: Event) {
  (event.currentTarget as HTMLInputElement).select();
}

watch(
  () => blockStore.chainName,
  () => {
    ++generation;
    searching.value = false;
    errorMessage.value = '';
  }
);

onScopeDispose(() => {
  ++generation;
});

function findMatchingValidator(
  validators: Validator[],
  targetHex: string
): Validator | undefined {
  return validators.find(
    (v) =>
      normalizeConsensusHex(consensusPubkeyToHexAddress(v.consensus_pubkey)) ===
      targetHex
  );
}

async function resolveConsensusOperator(
  consensusBytes: Uint8Array,
  reqGen: number
): Promise<{ operatorAddress: string; error: string }> {
  const targetHex = toHex(consensusBytes).toUpperCase();

  if (
    stakingStore.validatorsComplete?.BOND_STATUS_BONDED &&
    Array.isArray(stakingStore.validators)
  ) {
    const cachedMatch = findMatchingValidator(stakingStore.validators, targetHex);
    if (cachedMatch?.operator_address) {
      return { operatorAddress: cachedMatch.operator_address, error: '' };
    }
  }

  if (!blockStore.rpc) {
    return {
      operatorAddress: '',
      error: 'RPC client is unavailable to resolve consensus address.',
    };
  }

  for (const status of [
    'BOND_STATUS_BONDED',
    'BOND_STATUS_UNBONDING',
    'BOND_STATUS_UNBONDED',
  ]) {
    const res = await fetchAllStakingValidators(blockStore.rpc, status);
    if (reqGen !== generation) {
      return { operatorAddress: '', error: '' };
    }
    if (!res.complete) {
      const partialMatch = findMatchingValidator(res.validators, targetHex);
      if (partialMatch?.operator_address) {
        return { operatorAddress: partialMatch.operator_address, error: '' };
      }
      return {
        operatorAddress: '',
        error: `Could not verify consensus address because validator set failed to load: ${res.error}`,
      };
    }
    const match = findMatchingValidator(res.validators, targetHex);
    if (match?.operator_address) {
      return { operatorAddress: match.operator_address, error: '' };
    }
  }

  return {
    operatorAddress: '',
    error: 'Unknown consensus address: no matching validator found on this chain.',
  };
}

async function confirm() {
  if (searching.value) return;
  errorMessage.value = '';
  const key = searchQuery.value.trim();
  if (!key) {
    errorMessage.value = 'Please enter a value!';
    return;
  }

  const height = /^\d+$/;
  const txhash = /^[A-Fa-f\d]{64}$/;
  const current = blockStore?.current?.chainName || blockStore.chainName || '';
  const routeParams = vueRouters?.currentRoute?.value?.params || {};

  if (Object.values(routeParams).includes(key)) {
    return;
  }

  if (height.test(key)) {
    vueRouters.push({ path: `/${current}/block/${key}` });
    closeSearchModal();
    return;
  }

  if (txhash.test(key)) {
    vueRouters.push({ path: `/${current}/tx/${key.toUpperCase()}` });
    closeSearchModal();
    return;
  }

  const accountPrefix = blockStore.current?.bech32Prefix || '';
  const operatorPrefix = accountPrefix ? `${accountPrefix}valoper` : '';
  const consensusPrefix =
    blockStore.current?.bech32ConsensusPrefix ||
    (accountPrefix ? `${accountPrefix}valcons` : '');

  if (key.includes('1')) {
    let decoded: { prefix: string; data: Uint8Array };
    try {
      decoded = fromBech32(key);
    } catch {
      errorMessage.value = 'Invalid Bech32 address checksum or format.';
      return;
    }

    if (operatorPrefix && decoded.prefix === operatorPrefix) {
      vueRouters.push({ path: `/${current}/staking/${key}` });
      closeSearchModal();
      return;
    }
    if (accountPrefix && decoded.prefix === accountPrefix) {
      vueRouters.push({ path: `/${current}/account/${key}` });
      closeSearchModal();
      return;
    }
    if (consensusPrefix && decoded.prefix === consensusPrefix) {
      const reqGen = ++generation;
      searching.value = true;
      try {
        const result = await resolveConsensusOperator(decoded.data, reqGen);
        if (reqGen !== generation) return;
        if (result.operatorAddress) {
          vueRouters.push({
            path: `/${current}/staking/${result.operatorAddress}`,
          });
          closeSearchModal();
        } else if (result.error) {
          errorMessage.value = result.error;
        }
      } finally {
        if (reqGen === generation) searching.value = false;
      }
      return;
    }

    errorMessage.value = accountPrefix
      ? `Address prefix "${decoded.prefix}" does not match ${accountPrefix}.`
      : 'Address prefix is not recognized for the selected chain.';
    return;
  }

  errorMessage.value = 'The input not recognized';
}
</script>
<template>
  <div>
    <button
      class="btn btn-ghost btn-circle btn-sm mx-1"
      aria-label="Open search"
      @click="openSearchModal"
    >
      <Icon icon="mdi:magnify" class="text-2xl text-base-content/70" />
    </button>

    <!-- modal -->
    <div
      v-if="searchModalShow"
      class="cursor-pointer modal !pointer-events-auto !opacity-100 !visible"
      @click="closeSearchModal"
    >
      <form class="relative modal-box cursor-default" @click="stopClick" @submit.prevent="confirm">
        <!-- header -->
        <div class="flex items-center justify-between">
          <div class="text-lg font-bold flex flex-col md:!flex-row justify-between items-baseline">
            <span class="mr-2">Search</span>
            <span class="capitalize text-sm md:!text-base">Height/Transaction/Account/Validator Address</span>
          </div>
          <label htmlFor="modal-pool-modal" class="cursor-pointer" @click="closeSearchModal">
            <Icon icon="zondicons:close-outline" class="text-2xl text-base-content/70" />
          </label>
        </div>
        <!-- body -->
        <div class="mt-4">
          <div class="">
            <input
              class="input flex-1 w-full !input-bordered"
              v-model="searchQuery"
              placeholder="Height/Transaction/Account/Validator Address"
              @focus="selectValue"
              @click="selectValue"
            />
            <div v-if="searching" role="status" class="mt-2 text-right text-sm text-base-content/70">
              Resolving validator consensus address...
            </div>
            <div class="mt-2 text-right text-sm text-error" role="alert" v-show="errorMessage">
              {{ errorMessage }}
            </div>
          </div>
        </div>
        <!-- foot -->
        <div class="mt-6">
          <button type="submit" class="w-full btn btn-primary" :disabled="searching">
            {{ searching ? 'Searching...' : 'Confirm' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
