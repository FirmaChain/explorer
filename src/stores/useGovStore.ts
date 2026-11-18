// Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE)
import { defineStore } from 'pinia';
import { useBlockchain } from './useBlockchain';
import type { PageRequest, PaginatedProposals } from '@/types';
import { LoadingStatus } from './useDashboard';
import { useWalletStore } from './useWalletStore';
import { reactive } from 'vue';
import {
  applyProposalExclusionPolicy,
  type ExclusionPolicyConfig,
} from '@/libs/govHelpers';

export const useGovStore = defineStore('govStore', {
  state: () => {
    return {
      params: {
        deposit: {},
        voting: {},
        tally: {},
      },
      proposals: {} as Record<string, PaginatedProposals>,
      loading: {} as Record<string, LoadingStatus>,
      exclusionPolicy: { mode: 'airdrop_title' } as ExclusionPolicyConfig,
      excludedCountByStatus: {} as Record<string, number>,
    };
  },
  getters: {
    blockchain() {
      return useBlockchain();
    },
    walletstore() {
      return useWalletStore();
    },
  },
  actions: {
    initial() {
      this.$reset();
      this.fetchParams();
      this.fetchProposals('2');
    },
    async fetchProposals(status: string, pagination?: PageRequest) {
      //if (!this.loading[status]) {
      this.loading[status] = LoadingStatus.Loading;
      const proposals = reactive(await this.blockchain.rpc?.getGovProposals(status, pagination));

      // Apply configured exclusion policy (default preserves existing airdrop title filter)
      if (proposals?.proposals) {
        const applied = applyProposalExclusionPolicy(
          proposals.proposals,
          this.exclusionPolicy
        );
        proposals.proposals = applied.proposals;
        this.excludedCountByStatus[status] = applied.excludedCount;
      } else {
        this.excludedCountByStatus[status] = 0;
      }

      if (status === '2') {
        proposals?.proposals?.forEach((item) => {
          this.fetchTally(item.proposal_id).then((res) => {
            item.final_tally_result = res?.tally;
          });
          if (this.walletstore.currentAddress) {
            try {
              this.fetchProposalVotesVoter(item.proposal_id, this.walletstore.currentAddress)
                .then((res) => {
                  item.voterStatus = res?.vote?.option || 'VOTE_OPTION_NO_WITH_VETO';
                  // 'No With Veto';
                })
                .catch((reject) => {
                  item.voterStatus = 'VOTE_OPTION_NO_WITH_VETO';
                });
            } catch (error) {
              item.voterStatus = 'VOTE_OPTION_NO_WITH_VETO';
            }
          } else {
            item.voterStatus = 'VOTE_OPTION_NO_WITH_VETO';
          }
        });
      }

      this.loading[status] = LoadingStatus.Loaded;
      this.proposals[status] = proposals;
      //}
      return this.proposals[status];
    },
    async fetchParams() {
      // this.blockchain.rpc.getGovParamsDeposit().then(x => {
      //     this.params.deposit = x.deposit
      // })
    },
    async fetchTally(proposalId: string) {
      return await this.blockchain.rpc.getGovProposalTally(proposalId);
    },
    async fetchProposal(proposalId: string) {
      return this.blockchain.rpc.getGovProposal(proposalId);
    },
    async fetchProposalDeposits(proposalId: string, page?: PageRequest) {
      return this.blockchain.rpc.getGovProposalDeposits(proposalId, page);
    },
    async fetchProposalVotes(proposalId: string, page?: PageRequest) {
      return this.blockchain.rpc.getGovProposalVotes(proposalId, page);
    },
    async fetchProposalVotesVoter(proposalId: string, voter: string) {
      return this.blockchain.rpc.getGovProposalVotesVoter(proposalId, voter);
    },
  },
});
