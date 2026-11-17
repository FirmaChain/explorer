import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('reconstructs closed proposal votes across re-votes, weighted votes, final block, expedited rounds, failed txs, and rejects incomplete ranges', async () => {
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
  const { reconstructClosedProposalVotes } = await loadProduct(
    'src/libs/govHelpers.ts',
    {
      '@/libs/abci': abci,
      '@/libs/stakingConcentration': concentration,
      '@/types': types,
    }
  );

  const ok = reconstructClosedProposalVotes({
    proposalId: '13',
    startHeight: 100,
    endHeight: 103,
    roundStartHeight: 101, // expedited->regular transition at height 101
    coveredHeights: [100, 101, 102, 103],
    indexComplete: true,
    txs: [
      {
        height: 100,
        txIndex: 0,
        txhash: 'T0',
        code: 0,
        timestamp: '2026-11-01T00:00:00Z',
        messages: [{ type: 'MsgVote', proposalId: '13', voter: 'firma1old', option: 'VOTE_OPTION_YES' }],
      },
      {
        height: 101,
        txIndex: 0,
        txhash: 'T1',
        code: 0,
        timestamp: '2026-11-01T00:01:00Z',
        messages: [{ type: 'MsgVote', proposalId: '13', voter: 'firma1a', option: 'VOTE_OPTION_YES' }],
      },
      {
        height: 102,
        txIndex: 0,
        txhash: 'T2',
        code: 5, // failed tx must be ignored
        timestamp: '2026-11-01T00:02:00Z',
        messages: [{ type: 'MsgVote', proposalId: '13', voter: 'firma1a', option: 'VOTE_OPTION_NO' }],
      },
      {
        height: 103, // final tally block vote must be included, replacing firma1a's earlier YES
        txIndex: 1,
        txhash: 'T3',
        code: 0,
        timestamp: '2026-11-01T00:03:00Z',
        messages: [
          {
            type: 'MsgVoteWeighted',
            proposalId: '13',
            voter: 'firma1a',
            options: [
              { option: 'VOTE_OPTION_NO', weight: '0.7' },
              { option: 'VOTE_OPTION_ABSTAIN', weight: '0.3' },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(ok.complete, true);
  assert.equal(ok.votes.length, 1);
  assert.equal(ok.votes[0].voter, 'firma1a');
  assert.equal(ok.votes[0].summary, 'NO (70%), ABSTAIN (30%)');

  // Missing block 102 in range -> incomplete
  const missing = reconstructClosedProposalVotes({
    proposalId: '13',
    startHeight: 100,
    endHeight: 103,
    coveredHeights: [100, 101, 103],
    indexComplete: true,
    txs: [],
  });
  assert.equal(missing.complete, false);
  assert.match(missing.reason, /missing height 102/);
});
