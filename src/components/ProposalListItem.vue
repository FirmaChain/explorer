<script lang="ts" setup>
import { useBlockchain, useFormatter, useTxDialog } from '@/stores';
import { select } from '@/components/dynamic/index';
import type { PaginatedProposals } from '@/types';
import type { PropType } from 'vue';
import { ref } from 'vue';
const dialog = useTxDialog();
defineProps({
  proposals: { type: Object as PropType<PaginatedProposals> },
});

const format = useFormatter();
const chain = useBlockchain();
function showType(v: string) {
  if (v) {
    return v.substring(v.lastIndexOf('.') + 1);
  }
  return v;
}

const statusMap: Record<string, string> = {
  PROPOSAL_STATUS_VOTING_PERIOD: 'VOTING',
  PROPOSAL_STATUS_PASSED: 'PASSED',
  PROPOSAL_STATUS_REJECTED: 'REJECTED',
};

function statusLabel(status?: string) {
  return (status && statusMap[status]) || status || '';
}

function statusBadgeClass(status?: string) {
  const mapped = status ? statusMap[status] : '';
  if (mapped === 'PASSED') return 'bg-yes/20 text-yes';
  if (mapped === 'REJECTED') return 'bg-no/20 text-no';
  return 'bg-info/20 text-info';
}

const proposalInfo = ref();

function metaItem(metadata: string | undefined): { title?: string; summary?: string } {
  return metadata ? JSON.parse(metadata) : {};
}
</script>
<template>
  <div class="bg-white dark:bg-base-200 rounded text-sm">
    <table class="table-compact w-full table-fixed hidden lg:!table">
      <tbody>
        <tr v-for="(item, index) in proposals?.proposals" :key="index">
          <td class="px-4 w-20">
            <label
              for="proposal-detail-modal"
              class="text-main text-base hover:text-indigo-400 cursor-pointer"
              @click="proposalInfo = item"
            >
              #{{ item?.proposal_id }}</label
            >
          </td>
          <td class="w-full">
            <div>
              <RouterLink
                :to="`/${chain.chainName}/gov/${item?.proposal_id}`"
                class="text-main text-base mb-1 block hover:text-indigo-400 truncate"
              >
                {{
                  item.title
                }} {{ item.content?.title  }}
              </RouterLink>
              <div
                v-if="item.content"
                class="bg-base-200 text-base-content/80 inline-block rounded-full px-2 py-[1px] text-xs mb-1"
              >
                {{ showType(item.content['@type']) }}
              </div>
            </div>
          </td>
          <td class="w-36 px-2" data-proposal-status>
            <span
              class="inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-semibold tracking-wide whitespace-nowrap"
              :class="statusBadgeClass(item?.status)"
            >
              {{ statusLabel(item?.status) }}
            </span>
          </td>
          <td
            class="w-36 px-4 text-right text-sm font-medium text-base-content/80 tabular-nums whitespace-nowrap"
            data-proposal-date
          >
            {{ format.toDay(item.voting_end_time, 'date') }}
          </td>

          <td v-if="statusMap?.[item?.status] === 'VOTING'" class="w-32 pr-4 text-right">
            <div>
              <label
                for="vote"
                class="btn btn-xs btn-primary rounded-sm"
                @click="
                  dialog.open('vote', {
                    proposal_id: item?.proposal_id,
                  })
                "
              >
                <span v-if="item?.voterStatus !== 'VOTE_OPTION_NO_WITH_VETO'">{{
                  item?.voterStatus?.replace('VOTE_OPTION_', '')
                }}</span>

                <span v-else>Vote</span>
              </label>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="lg:!hidden divide-y divide-base-300/50">
      <div v-for="(item, index) in proposals?.proposals" :key="index" class="px-4 py-4">
        <div class="text-main text-base mb-1 flex justify-between hover:text-indigo-400">
          <RouterLink :to="`/${chain.chainName}/gov/${item?.proposal_id}`" class="flex-1 w-0 truncate mr-4">{{
            item?.content?.title || item?.title || metaItem(item?.metadata)?.title
          }}</RouterLink>
          <label
            for="proposal-detail-modal"
            class="text-main text-base hover:text-indigo-400 cursor-pointer"
            @click="proposalInfo = item"
          >
            #{{ item?.proposal_id }}</label
          >
        </div>

        <div v-if="item.content" class="mt-2">
          <div
            class="bg-base-200 text-base-content/80 inline-block rounded-full px-2 py-[1px] text-xs"
          >
            {{ showType(item.content['@type']) }}
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between gap-3">
          <span
            class="inline-flex items-center justify-center rounded-md px-2.5 py-1 text-sm font-semibold tracking-wide whitespace-nowrap"
            :class="statusBadgeClass(item?.status)"
          >
            {{ statusLabel(item?.status) }}
          </span>
          <div class="flex items-center gap-3">
            <div class="truncate text-sm font-medium text-base-content/80 tabular-nums">
              {{ format.toDay(item.voting_end_time, 'date') }}
            </div>
            <label
              v-if="statusMap?.[item?.status] === 'VOTING'"
              for="vote"
              class="btn btn-xs btn-primary rounded-sm"
              @click="
                dialog.open('vote', {
                  proposal_id: item?.proposal_id,
                })
              "
            >
              <span v-if="item?.voterStatus !== 'VOTE_OPTION_NO_WITH_VETO'">{{
                item?.voterStatus?.replace('VOTE_OPTION_', '')
              }}</span>

              <span v-else>Vote</span></label
            >
          </div>
        </div>
      </div>
    </div>

    <input type="checkbox" id="proposal-detail-modal" class="modal-toggle" />
    <label for="proposal-detail-modal" class="modal">
      <label class="modal-box !w-11/12 !max-w-5xl" for="">
        <label for="proposal-detail-modal" class="btn btn-sm btn-circle absolute right-2 top-2">✕</label>
        <h3 class="font-bold text-lg">Description</h3>
        <p class="py-4">
          <Component
            v-if="
              proposalInfo?.content?.description || proposalInfo?.summary || metaItem(proposalInfo?.metadata)?.summary
            "
            :is="
              select(
                proposalInfo?.content?.description ||
                  proposalInfo?.summary ||
                  metaItem(proposalInfo?.metadata)?.summary,
                'horizontal'
              )
            "
            :value="
              proposalInfo?.content?.description || proposalInfo?.summary || metaItem(proposalInfo?.metadata)?.summary
            "
          >
          </Component>
        </p>
      </label>
    </label>
  </div>
</template>
