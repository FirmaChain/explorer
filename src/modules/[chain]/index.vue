<script lang="ts" setup>
import { MdPreview } from 'md-editor-v3';
import PriceMarketChart from '@/components/charts/PriceMarketChart.vue';

import { Icon } from '@iconify/vue';
import { useBaseStore, useBlockchain, useFormatter, useTxDialog, useWalletStore, useStakingStore, useParamStore, useGovStore } from '@/stores';
import { LoadingStatus } from '@/stores/useDashboard';
import { onMounted, ref } from 'vue';
import { useIndexModule, tickerUrl } from './indexStore';
import { computed } from '@vue/reactivity';

import CardStatisticsVertical from '@/components/CardStatisticsVertical.vue';
import ProposalListItem from '@/components/ProposalListItem.vue';
import ArrayObjectElement from '@/components/dynamic/ArrayObjectElement.vue';
import Loading from '@/components/Loading.vue';
import DashboardConsensus from '@/components/DashboardConsensus.vue';
import DashboardVotingPower from '@/components/DashboardVotingPower.vue';
import DashboardTokenDistribution from '@/components/DashboardTokenDistribution.vue';
import DashboardRecentBlocks from '@/components/DashboardRecentBlocks.vue';

const props = defineProps(['chain']);

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const store = useIndexModule();
const walletStore = useWalletStore();
const format = useFormatter();
const dialog = useTxDialog();
const stakingStore = useStakingStore();
const paramStore = useParamStore();
const govStore = useGovStore();
const editorTheme = computed(() => (baseStore.theme === 'light' ? 'light' : 'dark'));
const coinInfo = computed(() => {
  return store.coinInfo;
});
const isNodeVersionLoading = computed(
  () => !Array.isArray(paramStore.nodeVersion?.items) || paramStore.nodeVersion.items.length === 0
);
const isProposalsLoading = computed(() => govStore.loading['2'] !== LoadingStatus.Loaded);

onMounted(() => {
  store.loadDashboard();
  walletStore.loadMyAsset();
  paramStore.handleAbciInfo();
  // if(!(coinInfo.value && coinInfo.value.name)) {
  // }
});
const ticker = computed(() => store.coinInfo.tickers[store.tickerIndex]);

const currName = ref('');
blockchain.$subscribe((m, s) => {
  if (s.chainName !== currName.value) {
    currName.value = s.chainName;
    store.loadDashboard();
    walletStore.loadMyAsset();
    paramStore.handleAbciInfo();
  }
});
function shortName(name?: string, id?: string) {
  if (!name) return id || '';
  return name.toLowerCase().startsWith('ibc/') || name.toLowerCase().startsWith('0x') ? id || name : name;
}

const comLinks = computed(() => {
  return [
    {
      name: 'Website',
      icon: 'mdi-web',
      href: store.homepage,
    },
    {
      name: 'Twitter',
      icon: 'mdi-twitter',
      href: store.twitter,
    },
    {
      name: 'Telegram',
      icon: 'mdi-telegram',
      href: store.telegram,
    },
    {
      name: 'Github',
      icon: 'mdi-github',
      href: store.github,
    },
  ];
});

// wallet box
const change = computed(() => {
  const token = walletStore.balanceOfStakingToken;
  return token ? format.priceChanges(token.denom) : 0;
});
const color = computed(() => {
  switch (true) {
    case change.value > 0:
      return 'text-green-600';
    case change.value < 0:
      return 'text-red-600';
    default:
      return 'text-gray-500 dark:text-gray-400';
  }
});

function updateState() {
  walletStore.loadMyAsset();
}

function trustColor(v?: string) {
  switch (v) {
    case 'green':
      return 'text-success';
    case 'yellow':
      return 'text-warning';
    case 'red':
      return 'text-error';
    default:
      return 'text-main';
  }
}

function formatUsdPrice(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return `$${num}`;
}

const quantity = ref(100);
const qty = computed({
  get: () => {
    return parseFloat(quantity.value.toFixed(6));
  },
  set: (val) => {
    quantity.value = val;
  },
});
const amount = computed({
  get: () => {
    return quantity.value * (ticker.value?.converted_last?.usd || 0);
  },
  set: (val) => {
    const usd = ticker.value?.converted_last?.usd || 0;
    quantity.value = usd ? val / usd : 0;
  },
});
</script>

<template>
  <div>
    <div v-if="coinInfo && coinInfo.name" class="bg-base-100 rounded shadow">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
        <div class="md:col-span-1">
          <div class="text-xl font-semibold text-main">
            {{ coinInfo.name }} (<span class="uppercase">{{ coinInfo.symbol }}</span
            >)
          </div>
          <div class="text-xs mt-2">
            {{ $t('index.rank') }}:
            <div
              class="badge text-xs badge-error border-0 bg-[#fcebea] dark:bg-[#41384d] text-red-400"
            >
              #{{ coinInfo.market_cap_rank }}
            </div>
          </div>

          <div class="my-4 flex flex-wrap items-center">
            <a
              v-for="(item, index) of comLinks"
              :key="index"
              :href="item.href"
              class="link link-primary px-2 py-1 rounded-sm no-underline hover:text-primary hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center"
            >
              <Icon :icon="item?.icon" />
              <span class="ml-1 text-sm uppercase">{{ item?.name }}</span>
            </a>
          </div>

          <div>
            <div class="dropdown dropdown-hover w-full">
              <label class="block w-full">
                <div
                  class="bg-gray-100 dark:bg-[#384059] flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer rounded"
                >
                  <div class="min-w-0">
                    <div
                      class="font-semibold text-xl text-main truncate"
                    >
                      {{ ticker?.market?.name || '-' }}
                    </div>
                    <div class="text-info text-sm truncate">
                      {{ shortName(ticker?.base, ticker?.coin_id) }}/{{
                        shortName(ticker?.target, ticker?.target_coin_id)
                      }}
                    </div>
                  </div>

                  <div class="text-right shrink-0">
                    <div
                      class="text-xl font-semibold text-main tabular-nums"
                    >
                      {{ formatUsdPrice(ticker?.converted_last?.usd) }}
                    </div>
                    <div v-if="store.priceChange !== ''" class="text-sm tabular-nums" :class="store.priceColor">
                      {{ store.priceChange }}%
                    </div>
                  </div>
                </div>
              </label>
              <div class="dropdown-content pt-1 w-full z-20">
                <div class="max-h-64 overflow-auto w-full shadow-lg rounded">
                  <ul class="menu w-full p-1 bg-gray-100 rounded dark:bg-[#384059]">
                    <li
                      v-for="(item, index) in store.coinInfo.tickers"
                      :key="index"
                      @click="store.selectTicker(index)"
                    >
                      <div
                        class="flex items-center justify-between gap-2 w-full hover:bg-base-100"
                      >
                        <div class="flex-1 min-w-0">
                          <div
                            class="text-sm font-medium truncate"
                            :class="trustColor(item.trust_score)"
                          >
                            {{ item?.market?.name }}
                          </div>
                          <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {{ shortName(item?.base, item?.coin_id) }}/{{
                              shortName(item?.target, item?.target_coin_id)
                            }}
                          </div>
                        </div>

                        <div class="text-sm font-medium text-main shrink-0 tabular-nums">
                          {{ formatUsdPrice(item?.converted_last?.usd) }}
                        </div>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 mt-4">
              <label class="btn btn-primary !px-1" for="calculator">
                <svg
                  class="w-8 h-8"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
                  <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
                  <g id="SVGRepo_iconCarrier">
                    <rect x="4" y="2" width="16" height="20" rx="2"></rect>
                    <line x1="8" x2="16" y1="6" y2="6"></line>
                    <line x1="16" x2="16" y1="14" y2="18"></line>
                    <path d="M16 10h.01"></path>
                    <path d="M12 10h.01"></path>
                    <path d="M8 10h.01"></path>
                    <path d="M12 14h.01"></path>
                    <path d="M8 14h.01"></path>
                    <path d="M12 18h.01"></path>
                    <path d="M8 18h.01"></path>
                  </g>
                </svg>
              </label>
              <!-- Put this part before </body> tag -->
              <input type="checkbox" id="calculator" class="modal-toggle" />
              <div class="modal">
                <div class="modal-box">
                  <h3 class="text-lg font-bold">
                    {{ $t('index.price_calculator') }}
                  </h3>
                  <div class="flex flex-col w-full mt-5">
                    <div
                      class="grid h-20 flex-grow card rounded-box place-items-center"
                    >
                      <div class="join w-full">
                        <label class="join-item btn">
                          <span class="uppercase">{{ coinInfo.symbol }}</span>
                        </label>
                        <input
                          type="number"
                          v-model="qty"
                          min="0"
                          placeholder="Input a number"
                          class="input grow input-bordered join-item"
                        />
                      </div>
                    </div>
                    <div class="divider">=</div>
                    <div
                      class="grid h-20 flex-grow card rounded-box place-items-center"
                    >
                      <div class="join w-full">
                        <label class="join-item btn">
                          <span>USD</span>
                        </label>
                        <input
                          type="number"
                          v-model="amount"
                          min="0"
                          placeholder="Input amount"
                          class="join-item grow input input-bordered"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <label class="modal-backdrop" for="calculator">{{
                  $t('index.close')
                }}</label>
              </div>
              <a
                class="btn grow"
                :class="
                  store.trustColor === 'green'
                    ? 'btn-success !text-white'
                    : store.trustColor === 'yellow'
                      ? 'btn-warning text-neutral-900'
                      : 'btn-primary !text-white'
                "
                :href="tickerUrl(ticker?.trade_url) || undefined"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ $t('index.buy') }} {{ coinInfo.symbol || '' }}
              </a>
            </div>
          </div>
        </div>

        <div class="md:col-span-2">
          <PriceMarketChart />
        </div>
      </div>
      <template v-if="coinInfo.description?.en?.trim()">
        <div class="h-[1px] w-full bg-gray-100 dark:bg-[#384059]"></div>
        <div class="max-h-[250px] overflow-auto p-4 text-sm">
          <MdPreview
            :model-value="coinInfo.description?.en"
            :theme="editorTheme"
            previewTheme="github"
            class="md-editor-recover chain-description-markdown"
          />
        </div>
      </template>
      <div v-if="coinInfo.categories?.length" class="px-4 pb-4 pt-1 flex flex-wrap items-center gap-2">
        <div
          v-for="tag in coinInfo.categories"
          :key="tag"
          class="text-xs bg-gray-100 dark:bg-[#384059] px-3 rounded-full py-1"
        >
          {{ tag }}
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 md:!grid-cols-3 lg:!grid-cols-6 mt-4">
      <div v-for="(item, key) in store.stats" :key="key">
        <CardStatisticsVertical v-bind="item" />
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 items-stretch">
      <div class="md:col-span-2 lg:col-span-1">
        <DashboardVotingPower :chain="props.chain" />
      </div>
      <div>
        <DashboardTokenDistribution :chain="props.chain" />
      </div>
      <div>
        <DashboardConsensus :chain="props.chain" />
      </div>
    </div>
    <DashboardRecentBlocks :chain="props.chain" />

    <div
      v-if="blockchain.supportModule('governance')"
      class="bg-base-100 rounded mt-4 shadow"
    >
      <div class="px-4 pt-4 pb-2 text-lg font-semibold text-main">
        {{ $t('index.active_proposals') }}
      </div>
      <Loading v-if="isProposalsLoading" :bordered="false" />
      <template v-else>
        <div class="px-4 pb-4">
          <ProposalListItem :proposals="store?.proposals" />
        </div>
        <div
          class="pb-8 text-center"
          v-if="store.proposals?.proposals?.length === 0"
        >
          {{ $t('index.no_active_proposals') }}
        </div>
      </template>
    </div>

    <div class="bg-base-100 rounded mt-4 shadow">
      <div class="flex justify-between px-4 pt-4 pb-2 text-lg font-semibold text-main">
        <span class="truncate">{{ walletStore.currentAddress || 'Not Connected' }}</span>
        <RouterLink
          v-if="walletStore.currentAddress"
          class="float-right text-sm cursor-pointert link link-primary no-underline font-medium"
          :to="`/${chain}/account/${walletStore.currentAddress}`"
          >{{ $t('index.more') }}</RouterLink
        >
      </div>
      <div
        class="grid grid-cols-1 md:!grid-cols-4 auto-cols-auto gap-4 px-4 pb-6"
      >
        <div class="bg-gray-100 dark:bg-[#373f59] rounded-sm px-4 py-3">
          <div class="text-sm mb-1">{{ $t('account.balance') }}</div>
          <div class="text-lg font-semibold text-main">
            {{ format.formatToken(walletStore.balanceOfStakingToken) }}
          </div>
          <div class="text-sm" :class="color">${{ format.tokenValue(walletStore.balanceOfStakingToken) }}</div>
        </div>
        <div class="bg-gray-100 dark:bg-[#373f59] rounded-sm px-4 py-3">
          <div class="text-sm mb-1">{{ $t('module.staking') }}</div>
          <div class="text-lg font-semibold text-main">
            {{ format.formatToken(walletStore.stakingAmount) }}
          </div>
          <div class="text-sm" :class="color">${{ format.tokenValue(walletStore.stakingAmount) }}</div>
        </div>
        <div class="bg-gray-100 dark:bg-[#373f59] rounded-sm px-4 py-3">
          <div class="text-sm mb-1">{{ $t('index.reward') }}</div>
          <div class="text-lg font-semibold text-main">
            {{ format.formatToken(walletStore.rewardAmount) }}
          </div>
          <div class="text-sm" :class="color">${{ format.tokenValue(walletStore.rewardAmount) }}</div>
        </div>
        <div class="bg-gray-100 dark:bg-[#373f59] rounded-sm px-4 py-3">
          <div class="text-sm mb-1">{{ $t('index.unbonding') }}</div>
          <div class="text-lg font-semibold text-main">
            {{ format.formatToken(walletStore.unbondingAmount) }}
          </div>
          <div class="text-sm" :class="color">${{ format.tokenValue(walletStore.unbondingAmount) }}</div>
        </div>
      </div>

      <div
        v-if="walletStore.delegations.length > 0"
        class="px-4 pb-4 overflow-auto"
      >
        <table class="table table-compact w-full table-zebra">
          <thead>
            <tr>
              <th>{{ $t('account.validator') }}</th>
              <th>{{ $t('account.delegations') }}</th>
              <th>{{ $t('account.rewards') }}</th>
              <th>{{ $t('staking.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in walletStore.delegations" :key="index">
              <td>
                <RouterLink
                  class="link link-primary no-underline"
                  :to="`/${chain}/staking/${item?.delegation?.validator_address}`"
                >
                  {{ format.validatorFromBech32(item?.delegation?.validator_address) }}
                </RouterLink>
              </td>
              <td>{{ format.formatToken(item?.balance) }}</td>
              <td>
                {{
                  format.formatTokens(
                    walletStore?.rewards?.rewards?.find(
                      (el) => el?.validator_address === item?.delegation?.validator_address
                    )?.reward
                  )
                }}
              </td>
              <td>
                <div>
                  <label
                    for="delegate"
                    class="btn !btn-xs !btn-primary btn-ghost rounded-sm mr-2"
                    @click="
                      dialog.open('delegate', { validator_address: item.delegation.validator_address }, updateState)
                    "
                  >
                    {{ $t('account.btn_delegate') }}
                  </label>
                  <label
                    for="withdraw"
                    class="btn !btn-xs !btn-primary btn-ghost rounded-sm"
                    @click="
                      dialog.open('withdraw', { validator_address: item.delegation.validator_address }, updateState)
                    "
                  >
                    {{ $t('index.btn_withdraw_reward') }}
                  </label>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="grid grid-cols-3 gap-4 px-4 pb-6 mt-4">
        <label for="PingTokenConvert" class="btn btn-primary text-white">{{ $t('index.btn_swap') }}</label>
        <label for="send" class="btn !bg-yes !border-yes text-white" @click="dialog.open('send', {}, updateState)">{{
          $t('account.btn_send')
        }}</label>
        <label
          for="delegate"
          class="btn !bg-info !border-info text-white"
          @click="dialog.open('delegate', {}, updateState)"
          >{{ $t('account.btn_delegate') }}</label
        >
        <RouterLink to="/wallet/receive" class="btn !bg-info !border-info text-white hidden">{{
          $t('index.receive')
        }}</RouterLink>
      </div>
      <Teleport to="body">
        <ping-token-convert
          :chain-name="blockchain?.current?.prettyName"
          :endpoint="blockchain?.endpoint?.address"
          :hd-path="walletStore?.connectedWallet?.hdPath"
        ></ping-token-convert>
      </Teleport>
    </div>

    <div v-if="!store.coingeckoId" class="bg-base-100 rounded mt-4">
      <div class="px-4 pt-4 pb-2 text-lg font-semibold text-main">
        {{ $t('index.node_info') }}
      </div>
      <Loading v-if="isNodeVersionLoading" :bordered="false" />
      <ArrayObjectElement v-else :value="paramStore.nodeVersion?.items" :thead="false" />
      <div class="h-4"></div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'dashboard',
      order: 1,
    }
  }
</route>

<style scoped lang="scss">
.chain-description-markdown {
  --md-bk-color: transparent;
  --md-color: hsl(var(--bc) / 0.85);
  --md-border-color: hsl(var(--bc) / 0.16);
  background-color: transparent;
}

.chain-description-markdown :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.chain-description-markdown :deep(.md-editor-preview) {
  --md-theme-color: hsl(var(--bc) / 0.85);
  --md-theme-bg-color: transparent;
  --md-theme-bg-color-inset: hsl(var(--b2));
  --md-theme-border-color: hsl(var(--bc) / 0.16);
  --md-theme-border-color-inset: hsl(var(--bc) / 0.22);
  --md-theme-link-color: hsl(var(--p));
  color: hsl(var(--bc) / 0.85);
  font-size: 0.875rem;
  line-height: 1.65;
  word-break: break-word;
}

.chain-description-markdown :deep(.md-editor-preview p) {
  margin-top: 0;
  margin-bottom: 0.75rem;
}

.chain-description-markdown :deep(.md-editor-preview p:last-child) {
  margin-bottom: 0;
}

.chain-description-markdown :deep(.md-editor-preview a) {
  color: hsl(var(--p)) !important;
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
