import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('preserves default airdrop title filter without hardcoding ID 7, while supporting auditable policy options', async () => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const abci = await loadProduct('src/libs/abci.ts', {
    'cross-fetch': fetch,
    '@/types': types,
  });
  const govHelpers = await loadProduct('src/libs/govHelpers.ts', {
    '@/libs/abci': abci,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  const sample = [
    { proposal_id: '7', title: 'Community Pool Spend' },
    { proposal_id: '8', title: 'Free AIRDROP Claim' },
    { proposal_id: '9', title: 'Parameter Change' },
  ];

  // Default policy retains ID 7 and excludes airdrop title
  const def = govHelpers.applyProposalExclusionPolicy(sample);
  assert.deepEqual(
    def.proposals.map((p) => p.proposal_id),
    ['7', '9']
  );
  assert.equal(def.excludedCount, 1);

  // Explicit ignore_ids policy when approved
  const byId = govHelpers.applyProposalExclusionPolicy(sample, {
    mode: 'ignore_ids',
    ignoredIds: ['7'],
  });
  assert.deepEqual(
    byId.proposals.map((p) => p.proposal_id),
    ['8', '9']
  );

  // Store uses default airdrop_title policy
  setActivePinia(createPinia());
  const { useGovStore } = await loadProduct('src/stores/useGovStore.ts', {
    './useBlockchain': {
      useBlockchain: () => ({
        rpc: {
          getGovProposals: async () => ({
            proposals: sample,
            pagination: { total: '3' },
          }),
        },
      }),
    },
    './useDashboard': { LoadingStatus: { Loading: 1, Loaded: 2 } },
    './useWalletStore': { useWalletStore: () => ({ currentAddress: '' }) },
    '@/libs/govHelpers': govHelpers,
    pinia: { defineStore },
  });
  const gov = useGovStore();
  assert.equal(gov.exclusionPolicy.mode, 'airdrop_title');
  const res = await gov.fetchProposals('3');
  assert.deepEqual(
    res.proposals.map((p) => p.proposal_id),
    ['7', '9']
  );
  assert.equal(gov.excludedCountByStatus['3'], 1);
});
