import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, text } from './helpers/validator-renderer.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function createParamsFixture(t, initial = {}) {
  const mintCalls = [];
  const blockchain = reactive({
    chainName: initial.chainName ?? 'firmachain',
    endpoint: { address: initial.endpoint ?? 'https://node-a.example' },
    current: {
      assets: [],
      excludes: initial.excludes ?? [],
    },
    rpc: {
      getBaseBlockLatest: async () => ({
        block: { header: { chain_id: 'firmachain-1', height: '100', time: '2026-11-17T00:00:00Z' } },
      }),
      getStakingParams: async () => ({ params: { bond_denom: 'ufct', max_validators: 100 } }),
      getStakingPool: async () => ({ pool: { bonded_tokens: '1000', not_bonded_tokens: '500' } }),
      getBankSupplyByDenom: async () => ({ amount: { amount: '2000', denom: 'ufct' } }),
      getSlashingParams: async () => ({ params: { signed_blocks_window: '100' } }),
      getDistributionParams: async () => ({ params: { community_tax: '0.02' } }),
      getGovParamsVoting: async () => ({ voting_params: { voting_period: '172800s' } }),
      getGovParamsDeposit: async () => ({ deposit_params: { min_deposit: [] } }),
      getGovParamsTally: async () => ({ tally_params: { quorum: '0.334' } }),
      getBaseNodeInfo: async () => ({
        application_version: { cosmos_sdk_version: '0.50.15' },
        default_node_info: { network: 'firmachain-1' },
      }),
      getMintParam: async () => {
        if (initial.mintHandler) return initial.mintHandler(mintCalls);
        return {
          params: {
            mint_denom: 'ufct',
            inflation_rate_change: '0.130000000000000000',
            inflation_max: '0.200000000000000000',
            inflation_min: '0.070000000000000000',
            goal_bonded: '0.670000000000000000',
            blocks_per_year: '6311520',
          },
        };
      },
    },
  });

  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => ({ validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };

  setActivePinia(createPinia());
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': {},
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const utils = await loadProduct('src/libs/utils.ts');
  const paramStoreMod = await loadProduct('src/stores/useParamsStore.ts', {
    '@/stores': stores,
    './useBlockchain': { useBlockchain: stores.useBlockchain },
    '@/libs/utils': utils,
    pinia: { defineStore },
  });
  stores.useParamStore = paramStoreMod.useParamStore;

  const cardParam = await loadProduct('src/components/CardParameter.vue', {
    '@/stores': stores,
    '@/libs/utils': utils,
    '@/components/Loading.vue': { default: () => 'Loading...' },
  });

  const paramsPage = (
    await loadProduct('src/modules/[chain]/params/index.vue', {
      '@/stores': stores,
      '@/components/CardParameter.vue': cardParam,
      '@/components/dynamic/ArrayObjectElement.vue': { default: () => null },
      '@/components/Loading.vue': { default: () => 'Loading...' },
    })
  ).default;

  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });

  const mounted = mount(paramsPage, {});
  t.after(() => mounted.app.unmount());

  return {
    ...mounted,
    blockchain,
    store: stores.useParamStore(),
    mintCalls,
  };
}

test('maps real mint parameters into Mint Parameters card while preserving other parameter cards', async (t) => {
  const f = await createParamsFixture(t);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(f.store.mintStatus, 'loaded');
  assert.match(text(f.container), /Mint Parameters/);
  assert.match(text(f.container), /ufct/);
  assert.match(text(f.container), /6311520/);
  assert.match(text(f.container), /67%/);
  assert.match(text(f.container), /20%/);
  assert.match(text(f.container), /7%/);
  assert.match(text(f.container), /Staking Parameters/);
  assert.match(text(f.container), /Governance Parameters/);
});

test('distinguishes unsupported mint module, empty response, and node error without faking data', async (t) => {
  const unsupported = await createParamsFixture(t, { excludes: ['mint'] });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(unsupported.store.mintStatus, 'unsupported');
  assert.match(text(unsupported.container), /Mint parameters are not supported on this chain/);

  const empty = await createParamsFixture(t, {
    mintHandler: async () => ({ params: {} }),
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(empty.store.mintStatus, 'empty');
  assert.match(text(empty.container), /No mint parameters were returned/);

  const errored = await createParamsFixture(t, {
    mintHandler: async () => {
      throw new Error('HTTP error: 503');
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(errored.store.mintStatus, 'error');
  assert.match(text(errored.container), /Could not load mint parameters\. HTTP error: 503/);
  assert.equal(findAll(errored.container, (el) => el.props.role === 'alert').length, 1);
});

test('chain switch clears stale mint params and discards late response from previous chain', async (t) => {
  const firstPending = deferred();
  const secondPending = deferred();
  let call = 0;

  const f = await createParamsFixture(t, {
    mintHandler: () => {
      call += 1;
      return call === 1 ? firstPending.promise : secondPending.promise;
    },
  });

  await nextTick();
  f.blockchain.chainName = 'otherchain';
  await nextTick();
  await nextTick();
  assert.deepEqual(f.store.mint.items, []);

  secondPending.resolve({
    params: { mint_denom: 'uatom', blocks_per_year: '4850000' },
  });
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();

  firstPending.resolve({
    params: { mint_denom: 'ustale', blocks_per_year: '1111111' },
  });
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();

  assert.match(text(f.container), /uatom/);
  assert.doesNotMatch(text(f.container), /ustale/);
});
