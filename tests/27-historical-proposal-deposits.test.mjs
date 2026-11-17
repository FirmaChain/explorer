import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('reconstructs individual closed proposal deposit events and timestamps, ignoring failed txs and rejecting incomplete ranges', async () => {
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
  const { reconstructClosedProposalDeposits } = await loadProduct(
    'src/libs/govHelpers.ts',
    {
      '@/libs/abci': abci,
      '@/libs/stakingConcentration': concentration,
      '@/types': types,
    }
  );

  const ok = reconstructClosedProposalDeposits({
    proposalId: '13',
    startHeight: 50,
    endHeight: 52,
    coveredHeights: [50, 51, 52],
    indexComplete: true,
    txs: [
      {
        height: 50,
        txIndex: 0,
        txhash: 'H50',
        code: 0,
        timestamp: '2026-10-01T00:00:00Z',
        messages: [
          {
            type: 'MsgSubmitProposal',
            proposalId: '13',
            depositor: 'firma1proposer',
            amount: [{ denom: 'ufct', amount: '1000000' }],
          },
        ],
      },
      {
        height: 51,
        txIndex: 0,
        txhash: 'H51',
        code: 1, // failed deposit ignored
        timestamp: '2026-10-01T00:01:00Z',
        messages: [
          {
            type: 'MsgDeposit',
            proposalId: '13',
            depositor: 'firma1fail',
            amount: [{ denom: 'ufct', amount: '5000000' }],
          },
        ],
      },
      {
        height: 52,
        txIndex: 0,
        txhash: 'H52',
        code: 0,
        timestamp: '2026-10-01T00:02:00Z',
        messages: [
          {
            type: 'MsgDeposit',
            proposalId: '13',
            depositor: 'firma1proposer',
            amount: [
              { denom: 'ufct', amount: '2000000' },
              { denom: 'uatom', amount: '100' },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(ok.complete, true);
  assert.equal(ok.events.length, 2);
  assert.equal(ok.events[0].kind, 'initial_deposit');
  assert.equal(ok.events[0].timestamp, '2026-10-01T00:00:00Z');
  assert.equal(ok.events[1].kind, 'deposit');
  assert.equal(ok.events[1].amount.length, 2);

  const pruned = reconstructClosedProposalDeposits({
    proposalId: '13',
    startHeight: 50,
    endHeight: 52,
    coveredHeights: [51, 52],
    indexComplete: false,
    indexError: 'pruned before height 51',
    txs: [],
  });
  assert.equal(pruned.complete, false);
  assert.match(pruned.reason, /pruned before height 51/);
});
