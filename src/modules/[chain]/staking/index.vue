<script lang="ts" setup>
import { useBaseStore, useBlockchain, useFormatter, useMintStore, useStakingStore, useTxDialog } from '@/stores';
import { computed } from '@vue/reactivity';
import { onMounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import type { Key, SlashingParam, Validator } from '@/types';
import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs';
import { formatSeconds } from '@/libs/utils';
import {
  computeValidatorConcentration,
  fetchCompleteConsensusValidatorSet,
  filterAndSortValidators,
  type ConsensusSetResult,
  type SortDirection,
  type ValidatorSortKey,
} from '@/libs/stakingConcentration';

const staking = useStakingStore();
const base = useBaseStore();
const format = useFormatter();
const dialog = useTxDialog();
const chainStore = useBlockchain();
const mintStore = useMintStore();

const cache = JSON.parse(localStorage.getItem('avatars') || '{}');
const avatars = ref(cache || {});
const latest = ref({} as Record<string, number>);
const yesterday = ref({} as Record<string, number>);
const tab = ref('active');
const unbondList = ref([] as Validator[]);
const slashing = ref({} as SlashingParam);
const searchQuery = ref('');
const sortKey = ref<ValidatorSortKey>('voting_power');
const sortDir = ref<SortDirection>('desc');
const consensusSet = ref<ConsensusSetResult>({
  validators: [],
  height: '',
  complete: false,
  error: 'Consensus validator set has not loaded yet.',
});
let loadGeneration = 0;

function toggleSort(key: ValidatorSortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
  } else {
    sortKey.value = key;
    sortDir.value = key === 'moniker' ? 'asc' : 'desc';
  }
}

async function loadPageData() {
  const gen = ++loadGeneration;
  unbondList.value = [];
  if (!chainStore.rpc) {
    consensusSet.value = {
      validators: [],
      height: '',
      complete: false,
      error: 'RPC client is unavailable.',
    };
    return;
  }

  const [unbonding, unbonded, slashingRes, consensusRes] = await Promise.all([
    staking.fetchUnbondingValdiators().catch(() => []),
    staking.fetchInacitveValdiators().catch(() => []),
    chainStore.rpc.getSlashingParams().catch(() => undefined),
    fetchCompleteConsensusValidatorSet(chainStore.rpc),
  ]);

  if (gen !== loadGeneration) return;
  unbondList.value = [...(unbonding || []), ...(unbonded || [])];
  if (slashingRes?.params) slashing.value = slashingRes.params;
  consensusSet.value = consensusRes;
}

onMounted(() => {
  loadPageData();
});

watch(
  () => [chainStore.chainName, chainStore.endpoint.address],
  ([nextChain, nextEndpoint], [prevChain, prevEndpoint]) => {
    if (nextChain === prevChain && nextEndpoint === prevEndpoint) return;
    loadPageData();
  }
);

async function fetchChange(blockWindow: number = 14400) {
  let page = 0;

  let height = Number(base.latest?.block?.header?.height || 0);
  if (height > blockWindow) {
    height -= blockWindow;
  } else {
    height = 1;
  }
  // voting power in 24h ago
  while (page < staking.validators.length && height > 0) {
    await base.fetchValidatorByHeight(height, page).then((x) => {
      x.validators.forEach((v) => {
        yesterday.value[v.pub_key.key] = Number(v.voting_power);
      });
    });
    page += 100;
  }

  page = 0;
  // voting power for now
  while (page < staking.validators.length) {
    await base.fetchLatestValidators(page).then((x) => {
      x.validators.forEach((v) => {
        latest.value[v.pub_key.key] = Number(v.voting_power);
      });
    });
    page += 100;
  }
}

const changes = computed(() => {
  const changes = {} as Record<string, number>;
  Object.keys(latest.value).forEach((k) => {
    const l = latest.value[k] || 0;
    const y = yesterday.value[k] || 0;
    changes[k] = l - y;
  });
  return changes;
});

const change24 = (entry: { consensus_pubkey: Key; tokens: string }) => {
  const txt = entry.consensus_pubkey.key;
  // const n: number = latest.value[txt];
  // const o: number = yesterday.value[txt];
  // // console.log( txt, n, o)
  // return n > 0 && o > 0 ? n - o : 0;

  const latestValue = latest.value[txt];
  if (!latestValue) {
    return 0;
  }

  const displayTokens = format.tokenAmountNumber({
    amount: parseInt(entry.tokens, 10).toString(),
    denom: staking.params.bond_denom,
  });
  const coefficient = displayTokens / latestValue;
  return changes.value[txt] * coefficient;
};

const change24Text = (entry: { consensus_pubkey: Key; tokens: string }) => {
  if (!entry) return '';
  const v = change24(entry);
  return v && v !== 0 ? format.showChanges(v) : '';
};

const change24Color = (entry: { consensus_pubkey: Key; tokens: string }) => {
  if (!entry) return '';
  const v = change24(entry);
  if (v > 0) return 'text-success';
  if (v < 0) return 'text-error';
};

const calculateRank = function (position: number) {
  let sum = 0;
  for (let i = 0; i < position; i++) {
    sum += Number(staking.validators[i]?.delegator_shares);
  }
  const percent = sum / staking.totalPower;

  switch (true) {
    case tab.value === 'active' && percent < 0.33:
      return 'error';
    case tab.value === 'active' && percent < 0.67:
      return 'warning';
    default:
      return 'primary';
  }
};

function isFeatured(endpoints: string[], who?: { website?: string; moniker: string }) {
  if (!endpoints || !who) return false;
  return (
    endpoints.findIndex(
      (x) =>
        (who.website && who.website?.substring(0, who.website?.lastIndexOf('.')).endsWith(x)) ||
        who?.moniker?.toLowerCase().search(x.toLowerCase()) > -1
    ) > -1
  );
}

const concentration = computed(() =>
  computeValidatorConcentration(
    consensusSet.value.validators,
    consensusSet.value.height,
    consensusSet.value.complete,
    consensusSet.value.error
  )
);

const listIncompleteWarning = computed(() => {
  const statuses =
    tab.value === 'inactive'
      ? ['BOND_STATUS_UNBONDING', 'BOND_STATUS_UNBONDED']
      : ['BOND_STATUS_BONDED'];
  const errors = statuses
    .filter((s) => staking.validatorsComplete?.[s] === false)
    .map((s) => staking.validatorsError?.[s] || `Incomplete ${s} validator list.`);
  return errors.join(' ');
});

const list = computed(() => {
  let baseItems: {
    v: Validator;
    rank: string;
    logo: string;
    change24: number;
    inTop34: boolean;
  }[] = [];

  if (tab.value === 'active') {
    baseItems = staking.validators.map((x, i) => {
      const hex = normalizeConsensusHex(
        consensusPubkeyToHexAddress(x.consensus_pubkey)
      );
      const inTop34 = Boolean(
        concentration.value.available &&
          hex &&
          concentration.value.boundaryHexes.has(hex)
      );
      return {
        v: x,
        rank: inTop34 ? 'error' : calculateRank(i),
        logo: logo(x.description?.identity),
        change24: change24(x),
        inTop34,
      };
    });
  } else if (tab.value === 'featured') {
    const endpoint = chainStore.current?.endpoints?.rest?.map((x) => x.provider);
    if (endpoint) {
      endpoint.push('ping');
      baseItems = staking.validators
        .filter((x) =>
          isFeatured(endpoint.filter(Boolean) as string[], x.description)
        )
        .map((x) => ({
          v: x,
          rank: 'primary',
          logo: logo(x.description?.identity),
          change24: change24(x),
          inTop34: false,
        }));
    }
  } else {
    baseItems = unbondList.value.map((x) => ({
      v: x,
      rank: 'primary',
      logo: logo(x.description?.identity),
      change24: change24(x),
      inTop34: false,
    }));
  }

  return filterAndSortValidators(
    baseItems,
    searchQuery.value,
    sortKey.value,
    sortDir.value
  );
});

const fetchAvatar = (identity: string) => {
  // fetch avatar from keybase
  return new Promise<void>((resolve) => {
    staking
      .keybase(identity)
      .then((d) => {
        if (Array.isArray(d.them) && d.them.length > 0) {
          const uri = String(d.them[0]?.pictures?.primary?.url).replace(
            'https://s3.amazonaws.com/keybase_processed_uploads/',
            ''
          );

          avatars.value[identity] = uri;
          resolve();
        } else throw new Error(`failed to fetch avatar for ${identity}`);
      })
      .catch((error) => {
        // console.error(error); // uncomment this if you want the user to see which avatars failed to load.
        resolve();
      });
  });
};

const loadAvatar = (identity: string) => {
  // fetches avatar from keybase and stores it in localStorage
  fetchAvatar(identity).then(() => {
    localStorage.setItem('avatars', JSON.stringify(avatars.value));
  });
};

const loadAvatars = () => {
  // fetches all avatars from keybase and stores it in localStorage
  const promises = staking.validators.map((validator) => {
    const identity = validator.description?.identity;

    // Here we also check whether we haven't already fetched the avatar
    if (identity && !avatars.value[identity]) {
      return fetchAvatar(identity);
    } else {
      return Promise.resolve();
    }
  });

  Promise.all(promises).then(() => localStorage.setItem('avatars', JSON.stringify(avatars.value)));
};

const logo = (identity?: string) => {
  if (!identity || !avatars.value[identity]) return '';
  const url = avatars.value[identity] || '';
  return url.startsWith('http') ? url : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
};

const loaded = ref(false);
base.$subscribe((_, s) => {
  if (s.recents.length >= 2 && loaded.value === false) {
    loaded.value = true;
    const diff_time = Date.parse(s.recents[1].block.header.time) - Date.parse(s.recents[0].block.header.time);
    const diff_height = Number(s.recents[1].block.header.height) - Number(s.recents[0].block.header.height);
    const block_window = Number(Number((86400 * 1000 * diff_height) / diff_time).toFixed(0));
    fetchChange(block_window);
  }
});

loadAvatars();
</script>
<template>
  <div>
    <div class="bg-base-100 rounded-lg grid sm:grid-cols-1 md:grid-cols-4 p-4">
      <div class="flex">
        <span>
          <div class="relative w-9 h-9 rounded overflow-hidden flex items-center justify-center mr-2">
            <Icon class="text-success" icon="mdi:trending-up" size="32" />
            <div class="absolute top-0 left-0 bottom-0 right-0 opacity-20 bg-success"></div>
          </div>
        </span>
        <span>
          <div class="font-bold">{{ format.percent(mintStore.inflation) }}</div>
          <div class="text-xs">{{ $t('staking.inflation') }}</div>
        </span>
      </div>
      <div class="flex">
        <span>
          <div class="relative w-9 h-9 rounded overflow-hidden flex items-center justify-center mr-2">
            <Icon class="text-primary" icon="mdi:lock-open-outline" size="32" />
            <div class="absolute top-0 left-0 bottom-0 right-0 opacity-20 bg-primary"></div>
          </div>
        </span>
        <span>
          <div class="font-bold">{{ formatSeconds(staking.params?.unbonding_time) }}</div>
          <div class="text-xs">{{ $t('staking.unbonding_time') }}</div>
        </span>
      </div>
      <div class="flex">
        <span>
          <div class="relative w-9 h-9 rounded overflow-hidden flex items-center justify-center mr-2">
            <Icon class="text-error" icon="mdi:alert-octagon-outline" size="32" />
            <div class="absolute top-0 left-0 bottom-0 right-0 opacity-20 bg-error"></div>
          </div>
        </span>
        <span>
          <div class="font-bold">{{ format.percent(slashing.slash_fraction_double_sign) }}</div>
          <div class="text-xs">{{ $t('staking.double_sign_slashing') }}</div>
        </span>
      </div>
      <div class="flex">
        <span>
          <div class="relative w-9 h-9 rounded overflow-hidden flex items-center justify-center mr-2">
            <Icon class="text-error" icon="mdi:pause" size="32" />
            <div class="absolute top-0 left-0 bottom-0 right-0 opacity-20 bg-error"></div>
          </div>
        </span>
        <span>
          <div class="font-bold">{{ format.percent(slashing.slash_fraction_downtime) }}</div>
          <div class="text-xs">{{ $t('staking.downtime_slashing') }}</div>
        </span>
      </div>
    </div>

    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 py-1">
        <div class="tabs tabs-boxed bg-transparent">
          <a class="tab text-gray-400" :class="{ 'tab-active': tab === 'featured' }" @click="tab = 'featured'">{{
            $t('staking.popular')
          }}</a>
          <a class="tab text-gray-400" :class="{ 'tab-active': tab === 'active' }" @click="tab = 'active'">{{
            $t('staking.active')
          }}</a>
          <a class="tab text-gray-400" :class="{ 'tab-active': tab === 'inactive' }" @click="tab = 'inactive'">{{
            $t('staking.inactive')
          }}</a>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="searchQuery"
            type="search"
            aria-label="Search validators by moniker or operator address"
            placeholder="Search moniker or address..."
            class="input input-bordered input-xs !h-7 !min-h-0 text-xs w-56"
          />
          <div class="text-lg font-semibold leading-7">{{ list.length }}/{{ staking.params.max_validators }}</div>
        </div>
      </div>

      <div
        v-if="listIncompleteWarning"
        role="alert"
        class="alert alert-warning text-xs py-2 mb-2"
      >
        <span>Validator list may be partial: {{ listIncompleteWarning }}</span>
      </div>

      <div class="bg-base-100 px-4 pt-3 pb-4 rounded shadow">
        <div class="overflow-x-auto">
          <table class="table staking-table w-full">
            <thead class="bg-base-200">
              <tr>
                <th scope="col" class="uppercase" style="width: 3rem; position: relative">
                  {{ $t('staking.rank') }}
                </th>
                <th scope="col" class="uppercase">
                  <button type="button" class="uppercase font-bold" @click="toggleSort('moniker')">
                    {{ $t('staking.validator') }}
                  </button>
                </th>
                <th scope="col" class="text-right uppercase">
                  <button type="button" class="uppercase font-bold" @click="toggleSort('voting_power')">
                    {{ $t('staking.voting_power') }}
                  </button>
                </th>
                <th scope="col" class="text-right uppercase">
                  <button type="button" class="uppercase font-bold" @click="toggleSort('changes_24h')">
                    {{ $t('staking.24h_changes') }}
                  </button>
                </th>
                <th scope="col" class="text-right uppercase">
                  <button type="button" class="uppercase font-bold" @click="toggleSort('commission')">
                    {{ $t('staking.commission') }}
                  </button>
                </th>
                <th scope="col" class="text-center uppercase">{{ $t('staking.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!list.length">
                <td colspan="6" class="text-center py-6 text-sm text-base-content/70">
                  No matching validators found.
                </td>
              </tr>
              <tr
                v-for="({ v, rank, logo, inTop34 }, i) in list"
                :key="v.operator_address"
                class="hover:bg-gray-100 dark:hover:bg-[#384059]"
              >
                <!-- 👉 rank -->
                <td>
                  <div class="text-xs truncate relative px-2 py-1 rounded-full w-fit" :class="`text-${rank}`">
                    <span class="inset-x-0 inset-y-0 opacity-10 absolute" :class="`bg-${rank}`"></span>
                    {{ i + 1 }}
                  </div>
                </td>
                <!-- 👉 Validator -->
                <td>
                  <div class="flex items-center overflow-hidden" style="max-width: 300px">
                    <div class="avatar mr-4 relative w-8 h-8 rounded-full">
                      <div class="w-8 h-8 rounded-full bg-gray-400 absolute opacity-10"></div>
                      <div class="w-8 h-8 rounded-full">
                        <img
                          v-if="logo"
                          :src="logo"
                          class="object-contain"
                          @error="
                            (e) => {
                              const identity = v.description?.identity;
                              if (identity) loadAvatar(identity);
                            }
                          "
                        />
                        <Icon v-else class="text-3xl" :icon="`mdi-help-circle-outline`" />
                      </div>
                    </div>

                    <div class="flex flex-col">
                      <span class="text-sm text-primary whitespace-nowrap overflow-hidden">
                        <RouterLink
                          :to="{
                            name: 'chain-staking-validator',
                            params: {
                              validator: v.operator_address,
                            },
                          }"
                          class="font-weight-medium"
                        >
                          {{ v.description?.moniker }}
                        </RouterLink>
                        <span
                          v-if="inTop34"
                          class="badge badge-error badge-xs ml-2 text-white"
                          title="Part of >=34% cumulative consensus voting power"
                          >34%</span
                        >
                      </span>
                      <span class="text-xs">{{ v.description?.website || v.description?.identity || '-' }}</span>
                    </div>
                  </div>
                </td>

                <!-- 👉 Voting Power -->
                <td class="text-right">
                  <div class="flex flex-col">
                    <h6 class="text-sm font-weight-medium whitespace-nowrap">
                      {{
                        format.formatToken(
                          {
                            amount: parseInt(v.tokens).toString(),
                            denom: staking.params.bond_denom,
                          },
                          true,
                          '0,0'
                        )
                      }}
                    </h6>
                    <span class="text-xs">{{ format.calculatePercent(v.delegator_shares, staking.totalPower) }}</span>
                  </div>
                </td>
                <!-- 👉 24h Changes -->
                <td class="text-right text-xs" :class="change24Color(v)">
                  {{ change24Text(v) }}
                </td>
                <!-- 👉 commission -->
                <td class="text-right text-xs">
                  {{ format.formatCommissionRate(v.commission?.commission_rates?.rate) }}
                </td>
                <!-- 👉 Action -->
                <td class="text-center">
                  <div v-if="v.jailed" class="badge badge-error gap-2 text-white">
                    {{ $t('staking.jailed') }}
                  </div>
                  <label
                    v-else
                    for="delegate"
                    class="btn btn-xs btn-primary rounded-sm capitalize"
                    @click="
                      dialog.open('delegate', {
                        validator_address: v.operator_address,
                      })
                    "
                    >{{ $t('account.btn_delegate') }}</label
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="divider"></div>
        <div class="flex flex-row items-center">
          <div class="text-xs truncate relative py-2 px-4 rounded-md w-fit text-error mr-2">
            <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-error"></span>
            {{ $t('staking.top') }} 33%
          </div>
          <div class="text-xs truncate relative py-2 px-4 rounded-md w-fit text-warning">
            <span class="inset-x-0 inset-y-0 opacity-10 absolute bg-warning"></span>
            {{ $t('staking.top') }} 67%
          </div>
          <div class="text-xs hidden md:!block pl-2">
            {{ $t('staking.description') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<route>
  {
    meta: {
      i18n: 'staking',
      order: 3
    }
  }
</route>

<style>
.staking-table.table :where(th, td) {
  padding: 8px 5px;
  background: transparent;
}
</style>
