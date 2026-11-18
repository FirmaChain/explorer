<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useBlockchain, useFormatter } from '@/stores';
import {
  PageRequest,
  type Pagination,
  type Coin,
  type DenomMetadata,
} from '@/types';
import type { Asset } from '@/types/chaindata';
import PaginationBar from '@/components/PaginationBar.vue';
import Loading from '@/components/Loading.vue';
const props = defineProps(['chain']);

const format = useFormatter();
const chainStore = useBlockchain();

const supplyCoins = ref([] as Coin[]);
const denomMetadatas = ref([] as DenomMetadata[]);
const loading = ref(true);

const pageRequest = ref(new PageRequest());
const pageResponse = ref({} as Pagination);

interface SupplyAsset extends Partial<Asset> {
  logo?: string;
  exponent?: string | number;
}

onMounted(() => {
  pageload(1);
});

function findGlobalAssetConfig(denom: string) {
  const assets = chainStore.current?.assets;
  if (assets) {
    return assets.find((a) => a.base === denom);
  }
  return undefined;
}

function mergeDenomMetadata(denom: string, metadatas: DenomMetadata[]): SupplyAsset | undefined {
  const denomMetadata =
    metadatas.find((d) => d.base === denom) || metadatas.find((d) => d.base?.endsWith(denom));
  const globalAsset = findGlobalAssetConfig(denom) as SupplyAsset | undefined;

  if (globalAsset && denomMetadata) {
    return {
      ...denomMetadata,
      ...globalAsset,
      display: denomMetadata.display || globalAsset.display,
      logo: globalAsset.logo_URIs?.svg || globalAsset.logo_URIs?.png || globalAsset.logo || undefined,
    };
  }

  return globalAsset || (denomMetadata as SupplyAsset | undefined);
}

function resolveSupplyAmount(coin: Coin, asset?: SupplyAsset): string {
  const unitExponent = asset?.denom_units?.reduce(
    (max, u) => (u.exponent > max ? u.exponent : max),
    0
  );
  const configExponent = asset?.exponent !== undefined ? Number(asset.exponent) : 0;
  const assetExponent = unitExponent || (Number.isFinite(configExponent) ? configExponent : 0);

  const amount =
    assetExponent > 0
      ? Number(coin.amount) / 10 ** assetExponent
      : format.tokenAmountNumber(coin);

  if (!Number.isFinite(amount)) return coin.amount;
  return amount.toLocaleString('en-US', { maximumFractionDigits: 18 });
}

const list = computed(() =>
  supplyCoins.value.map((coin) => {
    const asset = mergeDenomMetadata(coin.denom, denomMetadatas.value);
    const symbolOrDenom = asset?.symbol || coin.denom;
    const tokenName = (symbolOrDenom.split('/').pop() || coin.denom).toUpperCase();

    return {
      denom: tokenName,
      amount: resolveSupplyAmount(coin, asset),
      base: asset?.base || coin.denom,
      info: asset?.display || coin.denom,
      logo: asset?.logo_URIs?.svg || asset?.logo_URIs?.png || asset?.logo || '/logo.svg',
    };
  })
);

async function pageload(p: number) {
  pageRequest.value.setPage(p);
  loading.value = true;
  try {
    const [denomsMetaResponse, bankSupplyResponse] = await Promise.all([
      chainStore.rpc.getBankDenomMetadata().catch(() => ({ metadatas: [] as DenomMetadata[] })),
      chainStore.rpc.getBankSupply(pageRequest.value),
    ]);
    denomMetadatas.value = denomsMetaResponse?.metadatas ?? [];
    supplyCoins.value = bankSupplyResponse?.supply ?? [];
    pageResponse.value = bankSupplyResponse?.pagination ?? ({} as Pagination);
  } catch (err) {
    console.error('Failed to load bank supply:', err);
    denomMetadatas.value = [];
    supplyCoins.value = [];
    pageResponse.value = {} as Pagination;
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <div class="overflow-auto bg-base-100">
    <table class="table table-compact">
      <thead class="bg-base-200">
        <tr>
          <td>Logo</td>
          <td>Token</td>
          <td>Amount</td>
          <td>Info</td>
          <td>Base</td>
        </tr>
      </thead>
      <tbody v-if="!loading">
        <tr v-for="item in list" :key="item.base" class="hover">
          <td>
            <img v-if="item.logo" :src="item.logo" class="w-7 h-7" />
          </td>
          <td>{{ item.denom }}</td>
          <td>{{ item.amount }}</td>
          <td>{{ item.info }}</td>
          <td>{{ item.base }}</td>
        </tr>
      </tbody>
    </table>
    <Loading v-if="loading" :bordered="false" />
    <PaginationBar
      v-else
      :limit="pageRequest.limit"
      :total="pageResponse.total"
      :callback="pageload"
    />
  </div>
</template>

<route>
    {
      meta: {
        i18n: 'supply',
        order: 17
      }
    }
  </route>
