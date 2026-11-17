import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { text } from './helpers/validator-renderer.mjs';

test('computes BigInt token distribution and rejects zero denominator, negative residual, and partial failures', async (t) => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const blockSigs = await loadProduct('src/libs/blockSignatures.ts', {
    '@/libs/address': addresses,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });
  const metrics = await loadProduct('src/libs/dashboardMetrics.ts', {
    'cross-fetch': fetch,
    '@/libs/address': addresses,
    '@/libs/blockSignatures': blockSigs,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  const { computeTokenDistribution } = metrics;
  const ok = computeTokenDistribution('ufct', '1000000000', '600000000', '100000000');
  assert.equal(ok.available, true);
  assert.equal(ok.bondedPercent, '60.00%');
  assert.equal(ok.notBondedPercent, '10.00%');
  assert.equal(ok.remainingPercent, '30.00%');

  const neg = computeTokenDistribution('ufct', '1000', '700', '400');
  assert.equal(neg.available, false);
  assert.match(neg.reason, /exceeds total supply/);

  const zero = computeTokenDistribution('ufct', '0', '0', '0');
  assert.equal(zero.available, false);

  let failPool = false;
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: {
      assets: [
        { base: 'ufct', denom_units: [{ denom: 'ufct', exponent: 0 }, { denom: 'fct', exponent: 6 }] },
      ],
    },
    rpc: {
      getStakingParams: async () => ({ params: { bond_denom: 'ufct' } }),
      getBankSupplyByDenom: async () => ({ amount: { denom: 'ufct', amount: '1000000000' } }),
      getStakingPool: async () => {
        if (failPool) throw new Error('pool 503');
        return { pool: { bonded_tokens: '600000000', not_bonded_tokens: '100000000' } };
      },
    },
  });

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => ({ params: { bond_denom: 'ufct' }, validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const comp = (
    await loadProduct('src/components/DashboardTokenDistribution.vue', {
      '@/stores': stores,
      '@/libs/dashboardMetrics': metrics,
    })
  ).default;

  const mounted = mount(comp, reactive({ chain: 'firmachain' }));
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /Bonded \(60\.00%\).*600 FCT/);
  assert.match(text(mounted.container), /Unbonding \/ Not Bonded \(10\.00%\).*100 FCT/);
  assert.match(text(mounted.container), /Liquid \/ Other \(30\.00%\).*300 FCT/);

  failPool = true;
  blockchain.endpoint = { address: 'https://node-b.example' };
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /Could not load token distribution: pool 503/);
});
