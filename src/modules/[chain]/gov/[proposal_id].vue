<script lang="ts" setup>
import { computed } from '@vue/reactivity';
import MdEditor from 'md-editor-v3';
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
  return 'Unavailable';
});

const yes = computed(() => {
  if (total.value > 0) {
    const yes = proposal.value?.final_tally_result?.yes || 0;
    return format.percent(Number(yes) / total.value);
  }
  return 0;
});

const no = computed(() => {
  if (total.value > 0) {
    const value = proposal.value?.final_tally_result?.no || 0;
    return format.percent(Number(value) / total.value);
  }
  return 0;
});

const veto = computed(() => {
  if (total.value > 0) {
    const value = proposal.value?.final_tally_result?.no_with_veto || 0;
    return format.percent(Number(value) / total.value);
  }
  return 0;
});

const abstain = computed(() => {
  if (total.value > 0) {
    const value = proposal.value?.final_tally_result?.abstain || 0;
    return format.percent(Number(value) / total.value);
  }
  return 0;
});
const processList = computed(() => {
  return [
    { name: 'Turnout', value: turnout.value, class: 'bg-info' },
    { name: 'Yes', value: yes.value, class: 'bg-success' },
    { name: 'No', value: no.value, class: 'bg-error' },
    { name: 'No With Veto', value: veto.value, class: 'bg-red-800' },
    { name: 'Abstain', value: abstain.value, class: 'bg-warning' },
  ];
});

function metaItem(metadata: string | undefined): { title: string; summary: string } {
  if (!metadata) {
    return { title: '', summary: '' };
  } else if (metadata.startsWith('{') && metadata.endsWith('}')) {
    return JSON.parse(metadata);
  }
  return { title: metadata, summary: '' };
}
</script>

<template>
  <div>
    <div class="bg-base-100 px-4 pt-3 pb-4 rounded mb-4 shadow">
      <h2
        class="card-title flex flex-col md:!justify-between md:!flex-row mb-2"
      >
        <p class="truncate w-full">
          {{ proposal_id }}. {{ proposal.title }}
        </p>
        <div
          class="badge badge-ghost"
          :class="color === 'success' ? 'text-yes' : color === 'error' ? 'text-no' : 'text-info'"
        >
          {{ status }}
        </div>
      </h2>
      <div class="">
        <ObjectElement :value="proposal.content" />
      </div>
      <div v-if="proposal.summary">
        <MdEditor
          :model-value="
            format.multiLine(
              proposal.summary
            )
          "
          previewOnly
          class="md-editor-recover"
        ></MdEditor>
      </div>
    </div>
    <!-- grid lg:!!grid-cols-3 auto-rows-max-->
    <!-- flex-col lg:!!flex-row flex -->
    <div class="gap-4 mb-4 grid lg:!!grid-cols-3 auto-rows-max">
      <!-- flex-1 -->
      <div class="bg-base-100 px-4 pt-3 pb-4 rounded shadow">
        <h2 class="card-title mb-1">{{ $t('gov.tally') }}</h2>
        <div class="mb-1" v-for="(item, index) of processList" :key="index">
          <label class="block text-sm mb-1">{{ item.name }}</label>
          <div class="h-5 w-full relative">
            <div class="absolute inset-x-0 inset-y-0 w-full opacity-10 rounded-sm" :class="`${item.class}`"></div>
            <div
              class="absolute inset-x-0 inset-y-0 rounded-sm"
              :class="`${item.class}`"
              :style="`width: ${item.value === '-' || item.value === 'NaN%' ? '0%' : item.value}`"
            ></div>
            <p
              class="absolute inset-x-0 inset-y-0 text-center text-sm text-base-content flex items-center justify-center"
            >
              {{ item.value }}
            </p>
          </div>
        </div>
        <p
          v-if="turnoutSnapshot"
          class="text-xs text-base-content/70 mt-2"
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
            <div class="pl-5 text-sm mt-2">
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
