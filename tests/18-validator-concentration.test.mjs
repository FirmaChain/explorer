import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { text } from './helpers/validator-renderer.mjs';

function makeConsensusVal(seed, power) {
  const pub = Buffer.alloc(32, seed);
  const addrHex = toHex(sha256(pub).slice(0, 20)).toUpperCase();
  return {
    addrHex,
    tm: {
      address: addrHex,
      pub_key: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
      voting_power: String(power),
      proposer_priority: '0',
    },
    staking: {
      operator_address: `firmavaloper1val${seed}`,
      description: { moniker: `Val-${seed}`, identity: '' },
      tokens: String(BigInt(power) * 1000000n),
      delegator_shares: String(BigInt(power) * 1000000n),
      commission: { commission_rates: { rate: '0.1', max_rate: '0.2', max_change_rate: '0.01' } },
      consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
      jailed: false,
      status: 'BOND_STATUS_BONDED',
    },
  };
}

test('computeValidatorConcentration handles exact 34%, crossing, ties, zero denominator, and incomplete set', async () => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const { computeValidatorConcentration, fetchCompleteConsensusValidatorSet } =
    await loadProduct('src/libs/stakingConcentration.ts', {
      '@/libs/address': addresses,
      '@/types': types,
    });

  // Exact 34%: 20 + 14 + 66 = 100 -> top 2 reach 34% exactly
  const a = makeConsensusVal(1, 20);
  const b = makeConsensusVal(2, 14);
  const c = makeConsensusVal(3, 66); // c is largest (66%), so c alone exceeds 34%!
  const exact = computeValidatorConcentration([a.tm, b.tm, c.tm], '500', true);
  assert.equal(exact.available, true);
  assert.equal(exact.thresholdCount, 1);
  assert.deepEqual([...exact.boundaryHexes], [c.addrHex]);

  // Exact 34% across two validators: 20 + 14 + 14 + 14 + 14 + 12 + 12 = 100 -> 20 + 14 = 34 (ties at 14!)
  const t1 = makeConsensusVal(10, 20);
  const t2 = makeConsensusVal(11, 14);
  const t3 = makeConsensusVal(12, 14);
  const t4 = makeConsensusVal(13, 14);
  const t5 = makeConsensusVal(14, 14);
  const t6 = makeConsensusVal(15, 12);
  const t7 = makeConsensusVal(16, 12);
  const tied = computeValidatorConcentration(
    [t1.tm, t2.tm, t3.tm, t4.tm, t5.tm, t6.tm, t7.tm],
    '501',
    true
  );
  assert.equal(tied.available, true);
  // t1 (20) + t2 (14) crosses/hits 34%, and t3, t4, t5 are tied at 14
  assert.equal(tied.boundaryHexes.has(t1.addrHex), true);
  assert.equal(tied.boundaryHexes.has(t2.addrHex), true);
  assert.equal(tied.boundaryHexes.has(t3.addrHex), true);
  assert.equal(tied.boundaryHexes.has(t6.addrHex), false);

  // Zero denominator -> unavailable
  const zero = computeValidatorConcentration([makeConsensusVal(20, 0).tm], '502', true);
  assert.equal(zero.available, false);

  // Incomplete -> unavailable
  const incomplete = computeValidatorConcentration([a.tm], '503', false, 'Page 2 failed');
  assert.equal(incomplete.available, false);
  assert.match(incomplete.reason, /Page 2 failed/);

  // Multi-page same-height consensus validator set collection + height mismatch guard
  const pageCalls = [];
  const multi = await fetchCompleteConsensusValidatorSet({
    getBaseValidatorsetLatest: async () => {
      pageCalls.push('latest');
      return {
        block_height: '700',
        validators: [a.tm],
        pagination: { next_key: 'k2', total: '2' },
      };
    },
    getBaseValidatorsetAt: async (height, _offset, page) => {
      pageCalls.push(`${height}:${page?.key}`);
      return {
        block_height: '700',
        validators: [b.tm],
        pagination: { next_key: null, total: '2' },
      };
    },
  });
  assert.equal(multi.complete, true);
  assert.equal(multi.height, '700');
  assert.equal(multi.validators.length, 2);
  assert.deepEqual(pageCalls, ['latest', '700:k2']);

  // Height mismatch mid-pagination fails safely
  const mismatch = await fetchCompleteConsensusValidatorSet({
    getBaseValidatorsetLatest: async () => ({
      block_height: '700',
      validators: [a.tm],
      pagination: { next_key: 'k2' },
    }),
    getBaseValidatorsetAt: async () => ({
      block_height: '701',
      validators: [b.tm],
      pagination: { next_key: null },
    }),
  });
  assert.equal(mismatch.complete, false);
  assert.match(mismatch.error, /height mismatch/);
});

test('staking validator list hides concentration badges', async (t) => {
  const v1 = makeConsensusVal(31, 40);
  const v2 = makeConsensusVal(32, 30);
  const v3 = makeConsensusVal(33, 30);

  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: { assets: [], endpoints: { rest: [{ provider: 'FIRMACHAIN' }] } },
    rpc: {
      getStakingValidatorsPage: async (status) =>
        status === 'BOND_STATUS_BONDED'
          ? { validators: [v1.staking, v2.staking, v3.staking], pagination: {} }
          : { validators: [], pagination: {} },
      getSlashingParams: async () => ({ params: { slash_fraction_double_sign: '0.05', slash_fraction_downtime: '0.01' } }),
      getBaseValidatorsetLatest: async () => ({ block_height: '888', validators: [v1.tm, v2.tm, v3.tm], pagination: {} }),
      getBaseValidatorsetAt: async () => ({ block_height: '888', validators: [], pagination: {} }),
    },
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const utils = await loadProduct('src/libs/utils.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentrationMod = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useBaseStore: () => ({ recents: [], $subscribe: () => () => {} }),
    useMintStore: () => ({ inflation: '0.1' }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
    useTxDialog: () => ({ open: () => {} }),
  };
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const stakingStoreMod = await loadProduct('src/stores/useStakingStore.ts', {
    '@/libs': addresses,
    '@/libs/client': {},
    '@/libs/http': {},
    '@/libs/stakingConcentration': concentrationMod,
    './useBlockchain': { useBlockchain: () => blockchain },
    './useBaseStore': { useBaseStore: stores.useBaseStore },
    '@cosmjs/encoding': await import('@cosmjs/encoding'),
    pinia: { defineStore },
  });
  stores.useStakingStore = stakingStoreMod.useStakingStore;
  const staking = stores.useStakingStore();
  staking.params = { bond_denom: 'ufct', max_validators: 100 };

  const page = (
    await loadProduct('src/modules/[chain]/staking/index.vue', {
      '@/stores': stores,
      '@/libs': addresses,
      '@/libs/utils': utils,
      '@/libs/stakingConcentration': concentrationMod,
      '@iconify/vue': { Icon: () => null },
      '@vue/reactivity': await import('vue'),
    })
  ).default;

  const originalStorage = globalThis.localStorage;
  const originalDocument = globalThis.document;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });

  await staking.fetchAcitveValdiators();
  const mounted = mount(page, {});
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.doesNotMatch(text(mounted.container), /34%/);
});
