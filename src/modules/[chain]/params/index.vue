<script lang="ts" setup>
import { useBlockchain, useParamStore } from '@/stores';
import { ref, onMounted, watch } from 'vue';
import CardParameter from '@/components/CardParameter.vue';
import ArrayObjectElement from '@/components/dynamic/ArrayObjectElement.vue';
import Loading from '@/components/Loading.vue';
const store = useParamStore();
const blockchain = useBlockchain();
const chain = ref(store.chain);

const chainLoading = ref(true);
const mintLoading = ref(true);
const stakingLoading = ref(true);
const govLoading = ref(true);
const distributionLoading = ref(true);
const slashingLoading = ref(true);
const abciLoading = ref(true);

function loadAllParams() {
  chainLoading.value = true;
  mintLoading.value = true;
  stakingLoading.value = true;
  govLoading.value = true;
  distributionLoading.value = true;
  slashingLoading.value = true;
  abciLoading.value = true;

  store.handleBaseBlockLatest().finally(() => (chainLoading.value = false));
  store.handleMintParam().finally(() => (mintLoading.value = false));
  store.handleStakingParams().finally(() => (stakingLoading.value = false));
  store.handleGovernanceParams().finally(() => (govLoading.value = false));
  store.handleDistributionParams().finally(() => (distributionLoading.value = false));
  store.handleSlashingParams().finally(() => (slashingLoading.value = false));
  store.handleAbciInfo().finally(() => (abciLoading.value = false));
}

onMounted(() => {
  loadAllParams();
});

watch(
  () => [blockchain.chainName, blockchain.endpoint.address],
  ([nextChain, nextEndpoint], [prevChain, prevEndpoint]) => {
    if (nextChain === prevChain && nextEndpoint === prevEndpoint) return;
    store.resetMintParam();
    loadAllParams();
  }
);
</script>
<template>
  <div class="overflow-hidden">
    <!-- Chain ID -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded">
      <div class="text-base mb-3 text-main">{{ chain.title || 'Chain ID' }}</div>
      <Loading v-if="chainLoading" :bordered="false" />
      <div v-else class="grid grid-cols-2 md:!grid-cols-4 lg:!grid-cols-5 2xl:!grid-cols-6 gap-4">
        <div v-for="(item, index) of chain.items" :key="index" class="rounded-sm bg-active px-4 py-2">
          <div class="text-xs mb-2 text-secondary">{{ item.subtitle }}</div>
          <div class="text-base text-main">{{ item.value }}</div>
        </div>
      </div>
    </div>
    <!-- minting Parameters  -->
    <div
      v-if="
        store.mintStatus === 'unsupported' ||
        store.mintStatus === 'empty' ||
        store.mintStatus === 'error'
      "
      class="bg-base-100 px-4 pt-3 pb-4 rounded mt-5"
      data-mint-parameters
    >
      <div class="text-base mb-3 text-main">{{ store.mint.title }}</div>
      <p v-if="store.mintStatus === 'unsupported'" role="status" class="text-sm text-base-content/70">
        Mint parameters are not supported on this chain.
      </p>
      <p v-else-if="store.mintStatus === 'empty'" role="status" class="text-sm text-base-content/70">
        No mint parameters were returned by the node.
      </p>
      <div v-else role="alert" class="text-sm text-error">
        Could not load mint parameters. {{ store.mintError }}
      </div>
    </div>
    <CardParameter
      v-else
      :cardItem="store.mint"
      :loading="mintLoading || store.mintStatus === 'loading'"
    />
    <!-- Staking Parameters  -->
    <CardParameter :cardItem="store.staking" :loading="stakingLoading" />
    <!-- Governance Parameters -->
    <CardParameter :cardItem="store.gov" :loading="govLoading" />
    <!-- Distribution Parameters -->
    <CardParameter :cardItem="store.distribution" :loading="distributionLoading" />
    <!-- Slashing Parameters -->
    <CardParameter :cardItem="store.slashing" :loading="slashingLoading" />
    <!-- Application Version -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded-sm mt-6">
      <div class="text-base mb-3 text-main">{{ store.appVersion?.title }}</div>
      <Loading v-if="abciLoading" :bordered="false" />
      <ArrayObjectElement v-else :value="store.appVersion?.items" :thead="false" />
    </div>

    <!-- Node Information -->
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded-sm mt-6">
      <div class="text-base mb-3 text-main">{{ store.nodeVersion?.title }}</div>
      <Loading v-if="abciLoading" :bordered="false" />
      <ArrayObjectElement v-else :value="store.nodeVersion?.items" :thead="false" />
    </div>
  </div>
</template>

<route>
{
  meta: {
    i18n: 'parameters',
    order: 50
  }
}
</route>
