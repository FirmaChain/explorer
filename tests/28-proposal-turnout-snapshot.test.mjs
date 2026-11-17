import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('computes BigInt turnout accurately, marks unavailable on zero denominator or pruned snapshot, and distinguishes live vs closed', async () => {
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
  const { computeProposalTurnout } = await loadProduct(
    'src/libs/govHelpers.ts',
    {
      '@/libs/abci': abci,
      '@/libs/stakingConcentration': concentration,
      '@/types': types,
    }
  );

  const live = computeProposalTurnout(
    {
      yes: '300000000000',
      no: '50000000000',
      no_with_veto: '10000000000',
      abstain: '40000000000',
    },
    '1000000000000',
    { height: '900', isLiveEstimate: true }
  );
  assert.equal(live.available, true);
  assert.equal(live.percent, '40.00%');
  assert.equal(live.isLiveEstimate, true);

  // Zero denominator -> unavailable (never divides by fallback '1')
  const zero = computeProposalTurnout(
    { yes: '100', no: '0', no_with_veto: '0', abstain: '0' },
    '0',
    { height: '900', isLiveEstimate: true }
  );
  assert.equal(zero.available, false);

  // Pruned closed snapshot -> unavailable (never substitutes live pool)
  const pruned = computeProposalTurnout(
    { yes: '100', no: '0', no_with_veto: '0', abstain: '0' },
    '1000',
    {
      isLiveEstimate: false,
      snapshotUnavailableReason: 'Historical staking pool snapshot unavailable on pruned node.',
    }
  );
  assert.equal(pruned.available, false);
  assert.match(pruned.reason, /pruned node/);
});
