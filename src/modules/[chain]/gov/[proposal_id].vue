<script lang="ts" setup>
import { computed } from '@vue/reactivity';
import { MdPreview } from 'md-editor-v3';
import ObjectElement from '@/components/dynamic/ObjectElement.vue';
import { useBaseStore, useBlockchain, useFormatter, useGovStore, useStakingStore, useTxDialog } from '@/stores';
import type { GovProposal } from '@/types';
import { ref, reactive } from 'vue';
import Countdown from '@/components/Countdown.vue';
import ProposalDeposits from '@/components/ProposalDeposits.vue';
import ProposalVotes from '@/components/ProposalVotes.vue';
import ProposalNonVoters from '@/components/ProposalNonVoters.vue';
import { resolveRpcEndpoint } from '@/libs/abci';
import {
  computeProposalTurnout,
  queryStakingPoolAtHeight,
  type TurnoutSnapshotResult,
} from '@/libs/govHelpers';

const props = defineProps(['proposal_id', 'chain']);
const proposal = ref({} as GovProposal);
const format = useFormatter();
const store = useGovStore();
const dialog = useTxDialog();
const stakingStore = useStakingStore();
const chainStore = useBlockchain();
const baseStore = useBaseStore();

const editorTheme = computed(() =>
  baseStore.theme === 'light' ? 'light' : 'dark'
);

const turnoutSnapshot = ref<TurnoutSnapshotResult | null>(null);

async function refreshTurnoutSnapshot(p: GovProposal) {
  const isVoting = p.status === 'PROPOSAL_STATUS_VOTING_PERIOD';
  if (isVoting) {
    const bonded = stakingStore.pool?.bonded_tokens;
    const h = useBaseStore().latest?.block?.header?.height || '';
    turnoutSnapshot.value = computeProposalTurnout(
      p.final_tally_result,
      bonded,
      { height: h, isLiveEstimate: true }
    );
    return;
  }
  const rpc = resolveRpcEndpoint(chainStore.current);
  if (!rpc) {
    turnoutSnapshot.value = computeProposalTurnout(
      p.final_tally_result,
      undefined,
      {
        isLiveEstimate: false,
        snapshotUnavailableReason:
          'Historical proposal staking pool snapshot is unavailable without archive RPC height proof.',
      }
    );
    return;
  }
  try {
    // Check if historical pool query at a snapshot height is available
    const poolRes = await queryStakingPoolAtHeight(rpc, 1);
    turnoutSnapshot.value = computeProposalTurnout(
      p.final_tally_result,
      undefined,
      {
        height: poolRes.height,
        isLiveEstimate: false,
        snapshotUnavailableReason:
          'Exact per-proposal snapshot height is not provided in node REST/ABCI state; refusing to substitute current live pool.',
      }
    );
  } catch {
    turnoutSnapshot.value = computeProposalTurnout(
      p.final_tally_result,
      undefined,
      {
        isLiveEstimate: false,
        snapshotUnavailableReason:
          'Historical staking pool snapshot unavailable on this node.',
      }
    );
  }
}

store.fetchProposal(props.proposal_id).then((res) => {
  let proposalDetail = reactive(res.proposal);
  // when status under the voting, final_tally_result are no data, should request fetchTally
  if (res.proposal?.status === 'PROPOSAL_STATUS_VOTING_PERIOD') {
    store.fetchTally(props.proposal_id).then((tallRes) => {
      proposalDetail.final_tally_result = tallRes?.tally;
      void refreshTurnoutSnapshot(proposalDetail);
    });
  } else {
    void refreshTurnoutSnapshot(proposalDetail);
  }
  proposal.value = proposalDetail;
  // load origin params if the proposal is param change
  if (proposalDetail.content?.changes) {
    proposalDetail.content?.changes.forEach((item) => {
      chainStore.rpc.getParams(item.subspace, item.key).then((res) => {
        if (proposal.value.content && res.param) {
          if (proposal.value.content.current) {
            proposal.value.content.current.push(res.param);
          } else {
            proposal.value.content.current = [res.param];
          }
        }
      });
    });
  }

  const msgType = proposalDetail.content?.['@type'] || '';
  if (msgType.endsWith('MsgUpdateParams')) {
    if (msgType.indexOf('staking') > -1) {
      chainStore.rpc.getStakingParams().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('gov') > -1) {
      chainStore.rpc.getGovParamsVoting().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('distribution') > -1) {
      chainStore.rpc.getDistributionParams().then((res) => {
        addCurrentParams(res);
      });
    } else if (msgType.indexOf('slashing') > -1) {
      chainStore.rpc.getSlashingParams().then((res) => {
        addCurrentParams(res);
      });
    }
  }
});

function addCurrentParams(res: any) {
  if (proposal.value.content && res.params) {
    proposal.value.content.params = [proposal.value.content?.params];
    proposal.value.content.current = [res.params];
  }
}
const color = computed(() => {
  if (proposal.value.status === 'PROPOSAL_STATUS_PASSED') {
    return 'success';
  } else if (proposal.value.status === 'PROPOSAL_STATUS_REJECTED') {
    return 'error';
  }
  return '';
});
const statusBadgeClass = computed(() => {
  if (color.value === 'success') return 'bg-yes/20 text-yes';
  if (color.value === 'error') return 'bg-no/20 text-no';
  return 'bg-info/20 text-info';
});
const status = computed(() => {
  if (proposal.value.status) {
    return proposal.value.status.replace('PROPOSAL_STATUS_', '');
  }
  return '';
});

// Turnout uses verified snapshot/live-estimate helper rather than raw live pool fallback

function shortTime(v: string) {
  if (v) {
    return format.toDay(v, 'from');
  }
  return '';
}

const votingCountdown = computed((): number => {
  const now = new Date();
  const end = new Date(proposal.value.voting_end_time);
  return end.getTime() - now.getTime();
});

const upgradeCountdown = computed((): number => {
  const height = Number(proposal.value.content?.plan?.height || 0);
  if (height > 0) {
    const base = useBaseStore();
    const current = Number(base.latest?.block?.header?.height || 0);
    return (
      (height - current) * Number((base.blocktime / 1000).toFixed()) * 1000
    );
  }
  const now = new Date();
  const end = new Date(proposal.value.content?.plan?.time || '');
  return end.getTime() - now.getTime();
});

const total = computed(() => {
  const tally = proposal.value.final_tally_result;
  let sum = 0;
  if (tally) {
    sum += Number(tally.abstain || 0);
    sum += Number(tally.yes || 0);
    sum += Number(tally.no || 0);
    sum += Number(tally.no_with_veto || 0);
  }
  return sum;
});

const turnout = computed(() => {
  if (turnoutSnapshot.value?.available) {
    return turnoutSnapshot.value.percent;
  }
  return '-';
});

const turnoutBarWidth = computed(() => {
  if (!turnoutSnapshot.value?.available) {
    return '0%';
  }
  const pct = turnoutSnapshot.value.percent;
  return !pct || pct === '-' || pct === 'NaN%' ? '0%' : pct;
});

const voteOptions = computed(() => {
  const tally = proposal.value?.final_tally_result;
  const defs = [
    {
      key: 'yes',
      name: 'Yes',
      raw: tally?.yes,
      barClass: 'bg-success text-success-content',
      dotClass: 'bg-success',
    },
    {
      key: 'no',
      name: 'No',
      raw: tally?.no,
      barClass: 'bg-error text-error-content',
      dotClass: 'bg-error',
    },
    {
      key: 'no_with_veto',
      name: 'No With Veto',
      raw: tally?.no_with_veto,
      barClass: 'bg-red-800 text-white',
      dotClass: 'bg-red-800',
    },
    {
      key: 'abstain',
      name: 'Abstain',
      raw: tally?.abstain,
      barClass: 'bg-warning text-warning-content',
      dotClass: 'bg-warning',
    },
  ];

  return defs.map((item) => {
    const amount = Number(item.raw || 0);
    const ratio =
      total.value > 0 && Number.isFinite(amount) && amount > 0
        ? amount / total.value
        : 0;
    const rawPercent = ratio * 100;
    return {
      key: item.key,
      name: item.name,
      barClass: item.barClass,
      dotClass: item.dotClass,
      rawPercent,
      width: rawPercent > 0 ? `${rawPercent}%` : '0%',
      value: ratio > 0 ? format.percent(ratio) : '0%',
    };
  });
});

function metaItem(metadata: string | undefined): { title: string; summary: string } {
  if (!metadata) {
    return { title: '', summary: '' };
  }
  if (metadata.startsWith('{') && metadata.endsWith('}')) {
    try {
      return JSON.parse(metadata);
    } catch {
      return { title: metadata, summary: '' };
    }
  }
  return { title: metadata, summary: '' };
}

const proposalTitle = computed(
  () =>
    proposal.value.title ||
    proposal.value.content?.title ||
    metaItem(proposal.value.metadata).title ||
    ''
);

const proposalMarkdown = computed(
  () =>
    proposal.value.summary ||
    proposal.value.content?.description ||
    metaItem(proposal.value.metadata).summary ||
    ''
);

const proposalContentMeta = computed(() => {
  const content = proposal.value.content;
  if (!content || typeof content !== 'object') return undefined;
  const { description: _desc, ...rest } = content as Record<string, any>;
  return Object.keys(rest).length ? rest : undefined;
});
</script>

<template>
  <div>
    <!-- Proposal Header & Metadata (Type / Authority / Plan) -->
    <div class="bg-base-100 px-5 pt-4 pb-4 rounded mb-4 shadow">
      <div class="flex flex-col gap-2 md:!flex-row md:!items-start md:!justify-between">
        <h2 class="text-xl font-semibold text-base-content leading-snug break-words">
          {{ proposal_id }}. {{ proposalTitle }}
        </h2>
        <span
          v-if="status"
          class="inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-semibold tracking-wide whitespace-nowrap shrink-0 self-start md:mt-0.5"
          :class="statusBadgeClass"
          data-proposal-header-status
        >
          {{ status }}
        </span>
      </div>
      <div
        v-if="proposalContentMeta"
        class="border-t border-base-300/60 mt-4 pt-3"
      >
        <ObjectElement :value="proposalContentMeta" />
      </div>
    </div>

    <!-- Proposal Markdown Description -->
    <div
      v-if="proposalMarkdown"
      class="bg-base-100 px-5 pt-4 pb-5 rounded mb-4 shadow"
      data-proposal-description
    >
      <div class="text-sm font-semibold uppercase tracking-wide text-base-content/70 pb-3 mb-4 border-b border-base-300/60">
        Description
      </div>
      <MdPreview
        :model-value="format.multiLine(proposalMarkdown)"
        :theme="editorTheme"
        previewTheme="github"
        class="md-editor-recover proposal-markdown"
      />
    </div>
    <!-- grid lg:!!grid-cols-3 auto-rows-max-->
    <!-- flex-col lg:!!flex-row flex -->
    <div class="gap-4 mb-4 grid lg:!!grid-cols-3 auto-rows-max">
      <!-- flex-1 -->
      <div class="bg-base-100 px-4 pt-3 pb-4 rounded shadow">
        <h2 class="card-title mb-2">{{ $t('gov.tally') }}</h2>
        <div class="mb-3" data-proposal-turnout-row>
          <label class="block text-sm mb-1">Turnout</label>
          <div class="h-5 w-full relative overflow-hidden rounded-sm">
            <div class="absolute inset-0 w-full opacity-10 bg-info"></div>
            <div
              class="absolute inset-y-0 left-0 bg-info"
              :style="{ width: turnoutBarWidth }"
              data-proposal-turnout-bar
            ></div>
            <p
              class="absolute inset-0 text-center text-sm text-base-content flex items-center justify-center"
            >
              {{ turnout }}
            </p>
          </div>
          <p
            v-if="turnoutSnapshot"
            class="text-xs text-base-content/70 mt-1.5"
            data-proposal-turnout-note
          >
            <template v-if="turnoutSnapshot.available">
              Turnout is a live estimate using current bonded pool{{
                turnoutSnapshot.height ? ` at height #${turnoutSnapshot.height}` : ''
              }}.
            </template>
            <template v-else>
              Turnout unavailable: {{ turnoutSnapshot.reason }}
            </template>
          </p>
        </div>
        <div class="mb-1" data-proposal-votes-summary>
          <label class="block text-sm mb-1">{{ $t('gov.votes') }}</label>
          <div
            class="h-5 w-full rounded-sm overflow-hidden flex bg-base-content/10 relative"
            data-proposal-tally-bar
          >
            <div
              v-for="item in voteOptions"
              :key="item.key"
              class="h-full flex items-center justify-center text-xs font-medium overflow-hidden whitespace-nowrap transition-all duration-200"
              :class="item.barClass"
              :style="{ width: item.width }"
              :title="`${item.name}: ${item.value}`"
            >
              <span v-if="item.rawPercent >= 15" class="px-1 truncate">
                {{ item.value }}
              </span>
            </div>
            <p
              v-if="total <= 0"
              class="absolute inset-0 text-center text-sm text-base-content/70 flex items-center justify-center"
            >
              0%
            </p>
          </div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2 text-xs">
            <div
              v-for="item in voteOptions"
              :key="item.key"
              class="flex items-center justify-between gap-1.5 min-w-0"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span
                  class="w-2.5 h-2.5 rounded-sm shrink-0"
                  :class="item.dotClass"
                  aria-hidden="true"
                ></span>
                <span class="text-base-content/80 truncate">{{ item.name }}</span>
              </div>
              <span class="font-medium text-base-content tabular-nums shrink-0">
                {{ item.value }}
              </span>
            </div>
          </div>
        </div>
        <div class="mt-6 grid grid-cols-2">
          <label
            for="vote"
            class="btn btn-primary float-right btn-sm mx-1"
            @click="dialog.open('vote', { proposal_id })"
            >{{ $t('gov.btn_vote') }}</label
          >
          <label
            for="deposit"
            class="btn btn-primary float-right btn-sm mx-1"
            @click="dialog.open('deposit', { proposal_id })"
            >{{ $t('gov.btn_deposit') }}</label
          >
        </div>
      </div>

      <div class="bg-base-100 px-4 pt-3 pb-5 rounded shadow lg:!!col-span-2">
        <h2 class="card-title">{{ $t('gov.timeline') }}</h2>

        <div class="px-1">
          <div class="flex items-center mb-4 mt-2">
            <div class="w-2 h-2 rounded-full bg-error mr-3"></div>
            <div class="text-base flex-1 text-main">
              {{ $t('gov.submit_at') }}:
              {{ format.toDay(proposal.submit_time) }}
            </div>
            <div class="text-sm">{{ shortTime(proposal.submit_time) }}</div>
          </div>
          <div class="flex items-center mb-4">
            <div class="w-2 h-2 rounded-full bg-primary mr-3"></div>
            <div class="text-base flex-1 text-main">
              {{ $t('gov.deposited_at') }}:
              {{
                format.toDay(
                  proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
                    ? proposal.deposit_end_time
                    : proposal.voting_start_time
                )
              }}
            </div>
            <div class="text-sm">
              {{
                shortTime(
                  proposal.status === 'PROPOSAL_STATUS_DEPOSIT_PERIOD'
                    ? proposal.deposit_end_time
                    : proposal.voting_start_time
                )
              }}
            </div>
          </div>
          <div class="mb-4">
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-yes mr-3"></div>
              <div class="text-base flex-1 text-main">
                {{ $t('gov.vote_start_from') }}
                {{ format.toDay(proposal.voting_start_time) }}
              </div>
              <div class="text-sm">
                {{ shortTime(proposal.voting_start_time) }}
              </div>
            </div>
            <div
              v-if="proposal.status === 'PROPOSAL_STATUS_VOTING_PERIOD' && votingCountdown > 0"
              class="pl-5 text-sm mt-2"
            >
              <Countdown :time="votingCountdown" />
            </div>
          </div>
          <div>
            <div class="flex items-center mb-1">
              <div class="w-2 h-2 rounded-full bg-success mr-3"></div>
              <div class="text-base flex-1 text-main">
                {{ $t('gov.vote_end') }}
                {{ format.toDay(proposal.voting_end_time) }}
              </div>
              <div class="text-sm">
                {{ shortTime(proposal.voting_end_time) }}
              </div>
            </div>
            <div class="pl-5 text-sm">
              {{ $t('gov.current_status') }}:
              {{ $t(`gov.proposal_statuses.${proposal.status}`) }}
            </div>
          </div>

          <div class="mt-4" v-if="proposal?.content?.['@type']?.endsWith('SoftwareUpgradeProposal')">
            <div class="flex items-center">
              <div class="w-2 h-2 rounded-full bg-warning mr-3"></div>
              <div class="text-base flex-1 text-main">
                {{ $t('gov.upgrade_plan') }}:
                <span v-if="Number(proposal.content?.plan?.height || '0') > 0"> (EST)</span>
                <span v-else>{{ format.toDay(proposal.content?.plan?.time) }}</span>
              </div>
              <div class="text-sm">
                {{ shortTime(proposal.voting_end_time) }}
              </div>
            </div>
            <div class="pl-5 text-sm mt-2">
              <Countdown :time="upgradeCountdown" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <ProposalDeposits
      :proposal-id="String(props.proposal_id)"
      :chain="String(props.chain)"
      :proposal-status="proposal.status"
    />

    <ProposalVotes
      :proposal-id="String(props.proposal_id)"
      :chain="String(props.chain)"
      :proposal-status="proposal.status"
    />

    <ProposalNonVoters
      :proposal-id="String(props.proposal_id)"
      :chain="String(props.chain)"
      :proposal-status="proposal.status"
    />
  </div>
</template>

<style scoped lang="scss">
.proposal-markdown {
  --md-bk-color: transparent;
  --md-color: hsl(var(--bc));
  --md-border-color: hsl(var(--bc) / 0.16);
  background-color: transparent;
}

.proposal-markdown :deep(.md-editor-preview-wrapper) {
  padding: 0;
}

.proposal-markdown :deep(.md-editor-preview) {
  --md-theme-color: hsl(var(--bc) / 0.92);
  --md-theme-bg-color: transparent;
  --md-theme-bg-color-inset: hsl(var(--b2));
  --md-theme-border-color: hsl(var(--bc) / 0.16);
  --md-theme-border-color-inset: hsl(var(--bc) / 0.22);
  --md-theme-link-color: hsl(var(--p));
  --github-theme-code-inline-color: hsl(var(--bc));
  --github-theme-code-inline-bg-color: hsl(var(--b2));
  --github-theme-code-block-bg-color: hsl(var(--b2));
  --github-theme-code-block-color: hsl(var(--bc) / 0.92);
  --github-theme-table-border-color: hsl(var(--bc) / 0.16);
  --github-theme-table-bg-color: hsl(var(--b2) / 0.55);
  color: hsl(var(--bc) / 0.92);
  font-size: 0.95rem;
  line-height: 1.75;
  word-break: break-word;
}

.proposal-markdown :deep(.md-editor-preview h1),
.proposal-markdown :deep(.md-editor-preview h2),
.proposal-markdown :deep(.md-editor-preview h3),
.proposal-markdown :deep(.md-editor-preview h4) {
  color: hsl(var(--bc));
  font-weight: 600;
  line-height: 1.35;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  word-break: break-word;
}

.proposal-markdown :deep(.md-editor-preview > :first-child) {
  margin-top: 0;
}

.proposal-markdown :deep(.md-editor-preview h1) {
  font-size: 1.5rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid hsl(var(--bc) / 0.14);
}

.proposal-markdown :deep(.md-editor-preview h2) {
  font-size: 1.25rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid hsl(var(--bc) / 0.12);
}

.proposal-markdown :deep(.md-editor-preview h3) {
  font-size: 1.1rem;
}

.proposal-markdown :deep(.md-editor-preview p) {
  margin-top: 0;
  margin-bottom: 0.95rem;
  line-height: 1.75;
}

.proposal-markdown :deep(.md-editor-preview ul),
.proposal-markdown :deep(.md-editor-preview ol) {
  margin: 0.65rem 0 1rem;
  padding-left: 1.5rem;
}

.proposal-markdown :deep(.md-editor-preview ul) {
  list-style-type: disc;
}

.proposal-markdown :deep(.md-editor-preview ol) {
  list-style-type: decimal;
}

.proposal-markdown :deep(.md-editor-preview li + li) {
  margin-top: 0.35rem;
}

.proposal-markdown :deep(.md-editor-preview blockquote) {
  margin: 1rem 0;
  padding: 0.65rem 1rem;
  border-left: 3px solid hsl(var(--p));
  background-color: hsl(var(--b2) / 0.6);
  border-radius: 0 0.375rem 0.375rem 0;
  color: hsl(var(--bc) / 0.85);
}

.proposal-markdown :deep(.md-editor-preview blockquote p:last-child) {
  margin-bottom: 0;
}

.proposal-markdown :deep(.md-editor-preview code) {
  font-size: 0.85em;
  background-color: hsl(var(--b2));
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
}

.proposal-markdown :deep(.md-editor-preview pre) {
  margin: 1rem 0;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--bc) / 0.12);
  overflow-x: auto;
}

.proposal-markdown :deep(.md-editor-preview pre code) {
  display: block;
  padding: 0.9rem 1rem;
  background-color: hsl(var(--b2));
  line-height: 1.6;
}

.proposal-markdown :deep(.md-editor-preview table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.875rem;
}

.proposal-markdown :deep(.md-editor-preview th),
.proposal-markdown :deep(.md-editor-preview td) {
  border: 1px solid hsl(var(--bc) / 0.18);
  padding: 0.5rem 0.75rem;
}

.proposal-markdown :deep(.md-editor-preview th) {
  background-color: hsl(var(--b2));
  font-weight: 600;
}

.proposal-markdown :deep(.md-editor-preview hr) {
  border: none;
  border-top: 1px solid hsl(var(--bc) / 0.15);
  margin: 1.25rem 0;
}

.proposal-markdown :deep(.md-editor-preview a) {
  color: hsl(var(--p)) !important;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.proposal-markdown :deep(.md-editor-preview img) {
  max-width: 100%;
  border-radius: 0.375rem;
  margin: 0.75rem 0;
}
</style>
