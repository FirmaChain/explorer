<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs/address';
import { selectRecentDashboardBlocks } from '@/libs/dashboardMetrics';
import { useBaseStore, useBlockchain, useFormatter, useStakingStore } from '@/stores';
import type { Validator } from '@/types';

const props = defineProps<{ chain: string }>();

const baseStore = useBaseStore();
const blockchain = useBlockchain();
const format = useFormatter();
const stakingStore = useStakingStore();

function readCachedAvatars(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem('avatars') || '{}') || {};
  } catch {
    return {};
  }
}

const avatars = ref<Record<string, string>>(readCachedAvatars());
const loadingIdentities = new Set<string>();

function logoUrl(identity?: string): string {
  if (!identity || !avatars.value[identity]) return '';
  const url = avatars.value[identity];
  return url.startsWith('http')
    ? url
    : `https://s3.amazonaws.com/keybase_processed_uploads/${url}`;
}

function loadAvatar(identity?: string) {
  if (
    !identity ||
    avatars.value[identity] ||
    loadingIdentities.has(identity) ||
    typeof stakingStore.keybase !== 'function'
  ) {
    return;
  }
  loadingIdentities.add(identity);
  Promise.resolve(stakingStore.keybase(identity))
    .then((d) => {
      const url = d?.them?.[0]?.pictures?.primary?.url;
      if (!url) return;
      const uri = String(url).replace(
        'https://s3.amazonaws.com/keybase_processed_uploads/',
        ''
      );
      avatars.value = { ...avatars.value, [identity]: uri };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('avatars', JSON.stringify(avatars.value));
      }
    })
    .catch(() => {
      // Fallback icon remains rendered when Keybase lookup fails
    })
    .finally(() => {
      loadingIdentities.delete(identity);
    });
}

const chainMatched = computed(
  () => !blockchain.chainName || blockchain.chainName === props.chain
);

const recentBlocks = computed(() => {
  if (!chainMatched.value) return [];
  return selectRecentDashboardBlocks(
    baseStore.recents,
    baseStore.currentChainId,
    7
  );
});

const validatorsByHex = computed(() => {
  const map = new Map<string, Validator>();
  for (const v of stakingStore.validators || []) {
    const hex = normalizeConsensusHex(
      consensusPubkeyToHexAddress(v.consensus_pubkey)
    );
    if (hex) map.set(hex, v);
  }
  return map;
});

function proposerValidator(proposerAddress?: string): Validator | undefined {
  const hex = normalizeConsensusHex(proposerAddress);
  if (!hex) return undefined;
  return validatorsByHex.value.get(hex);
}

watch(
  [recentBlocks, validatorsByHex],
  ([blocks]) => {
    for (const block of blocks) {
      const identity = proposerValidator(block.block?.header?.proposer_address)
        ?.description?.identity;
      if (identity) loadAvatar(identity);
    }
  },
  { immediate: true }
);
</script>

<template>
  <section
    class="bg-base-100 rounded mt-4 shadow p-4"
    aria-labelledby="dashboard-recent-blocks-heading"
    data-dashboard-recent-blocks
  >
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <h2 id="dashboard-recent-blocks-heading" class="text-lg font-semibold text-main">
        Recent Blocks
      </h2>
      <RouterLink
        :to="`/${chain}/block`"
        class="text-sm link link-primary no-underline"
      >
        {{ $t('index.more') }}
      </RouterLink>
    </div>
    <p class="text-xs text-base-content/70 mb-3">
      Up to 7 latest unique blocks from the recent cache
      ({{ baseStore.isContiguous ? 'contiguous window' : 'cached samples, continuity not guaranteed' }}).
    </p>
    <div
      v-if="baseStore.lastPollError && recentBlocks.length === 0"
      role="alert"
      class="text-sm text-error py-2"
    >
      Could not load recent blocks: {{ baseStore.lastPollError }}
    </div>
    <p
      v-else-if="recentBlocks.length === 0"
      role="status"
      class="text-sm py-2"
    >
      No recent cached blocks available yet.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="table table-compact w-full text-sm">
        <thead>
          <tr>
            <th>{{ $t('account.height') }}</th>
            <th>Proposer</th>
            <th>{{ $t('block.txs') }}</th>
            <th>{{ $t('account.time') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in recentBlocks"
            :key="item.block.header.height"
          >
            <td>
              <RouterLink
                class="text-primary underline underline-offset-4 tabular-nums"
                :to="`/${chain}/block/${item.block.header.height}`"
              >
                {{ item.block.header.height }}
              </RouterLink>
            </td>
            <td class="max-w-[220px]">
              <RouterLink
                v-if="proposerValidator(item.block?.header?.proposer_address)"
                class="inline-flex items-center gap-2 text-primary hover:underline underline-offset-4 max-w-full"
                :to="`/${chain}/staking/${proposerValidator(item.block?.header?.proposer_address)!.operator_address}`"
              >
                <span
                  class="avatar w-6 h-6 rounded-full shrink-0 overflow-hidden bg-base-200 flex items-center justify-center"
                >
                  <img
                    v-if="logoUrl(proposerValidator(item.block?.header?.proposer_address)?.description?.identity)"
                    :src="logoUrl(proposerValidator(item.block?.header?.proposer_address)?.description?.identity)"
                    :alt="proposerValidator(item.block?.header?.proposer_address)?.description?.moniker || 'Validator'"
                    class="w-6 h-6 object-cover rounded-full"
                  />
                  <Icon
                    v-else
                    icon="mdi-help-circle-outline"
                    class="w-5 h-5 text-base-content/60"
                  />
                </span>
                <span class="truncate">
                  {{
                    proposerValidator(item.block?.header?.proposer_address)
                      ?.description?.moniker ||
                    proposerValidator(item.block?.header?.proposer_address)!
                      .operator_address
                  }}
                </span>
              </RouterLink>
              <span v-else class="truncate block">
                {{ format.validator(item.block?.header?.proposer_address) || '-' }}
              </span>
            </td>
            <td class="tabular-nums">
              {{ item.block?.data?.txs?.length || 0 }}
            </td>
            <td class="tabular-nums">
              <time
                v-if="item.block?.header?.time"
                :datetime="item.block.header.time"
              >
                {{ format.toDay(item.block.header.time, 'short') }}
              </time>
              <span v-else>-</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
