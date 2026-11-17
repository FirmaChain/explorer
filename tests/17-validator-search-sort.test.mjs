import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, rows, text } from './helpers/validator-renderer.mjs';

function makeValidator(moniker, operator_address, tokens, rate = '0.1', jailed = false) {
  return {
    operator_address,
    description: { moniker, identity: '' },
    tokens,
    delegator_shares: tokens,
    commission: { commission_rates: { rate, max_rate: '0.2', max_change_rate: '0.01' } },
    consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: Buffer.alloc(32, 1).toString('base64') },
    jailed,
    status: 'BOND_STATUS_BONDED',
  };
}

async function createStakingListFixture(t, { bondedPages, unbonding = [], unbonded = [], failPage2 = false } = {}) {
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: { assets: [], endpoints: { rest: [{ provider: 'FIRMACHAIN' }] } },
    rpc: {
      getStakingValidatorsPage: async (status, page) => {
        if (status === 'BOND_STATUS_BONDED') {
          if (!page?.key) return bondedPages[0];
          if (failPage2) throw new Error('HTTP 503 page 2');
          return bondedPages[1] || { validators: [], pagination: {} };
        }
        if (status === 'BOND_STATUS_UNBONDING') return { validators: unbonding, pagination: {} };
        if (status === 'BOND_STATUS_UNBONDED') return { validators: unbonded, pagination: {} };
        return { validators: [], pagination: {} };
      },
      getSlashingParams: async () => ({ params: { slash_fraction_double_sign: '0.05', slash_fraction_downtime: '0.01' } }),
      getBaseValidatorsetLatest: async () => ({ block_height: '100', validators: [], pagination: {} }),
      getBaseValidatorsetAt: async () => ({ block_height: '100', validators: [], pagination: {} }),
    },
  });

  const actions = [];
  const addresses = await loadProduct('src/libs/address.ts');
  const utils = await loadProduct('src/libs/utils.ts');

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useBaseStore: () => ({
      recents: [],
      $subscribe: () => () => {},
      fetchValidatorByHeight: async () => ({ validators: [] }),
      fetchLatestValidators: async () => ({ validators: [] }),
    }),
    useMintStore: () => ({ inflation: '0.1' }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
    useTxDialog: () => ({ open: (...args) => actions.push(args) }),
  };

  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });

  const stakingStoreMod = await loadProduct('src/stores/useStakingStore.ts', {
    '@/libs': addresses,
    '@/libs/client': {},
    '@/libs/http': {},
    '@/libs/stakingConcentration': concentration,
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
      '@/libs/stakingConcentration': concentration,
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

  return { ...mounted, staking, blockchain, actions, concentration };
}

test('paginates all validator pages, searches case-insensitively by moniker/address, and sorts numerically (not lexicographically)', async (t) => {
  const v9 = makeValidator('Beta', 'firmavaloper1beta', '900000000', '0.05');
  const v10 = makeValidator('Alpha', 'firmavaloper1alpha', '10000000000', '0.15');
  const v2 = makeValidator('gamma', 'firmavaloper1gamma', '2000000000', '0.02');

  const f = await createStakingListFixture(t, {
    bondedPages: [
      { validators: [v9, v10], pagination: { next_key: 'page2' } },
      { validators: [v2], pagination: { next_key: null } },
    ],
  });

  assert.equal(f.staking.validatorsComplete.BOND_STATUS_BONDED, true);
  assert.equal(rows(f.container).length, 3);
  // Numeric desc order: 10B (Alpha) > 2B (gamma) > 900M (Beta)
  assert.match(rows(f.container)[0], /Alpha/);
  assert.match(rows(f.container)[1], /gamma/);
  assert.match(rows(f.container)[2], /Beta/);

  // Sort by moniker ascending
  click(button(f.container, 'staking.validator'));
  await nextTick();
  assert.match(rows(f.container)[0], /Alpha/);
  assert.match(rows(f.container)[1], /Beta/);
  assert.match(rows(f.container)[2], /gamma/);

  // Sort by commission descending (0.15 > 0.05 > 0.02)
  click(button(f.container, 'staking.commission'));
  await nextTick();
  assert.match(rows(f.container)[0], /Alpha/);
  assert.match(rows(f.container)[1], /Beta/);
  assert.match(rows(f.container)[2], /gamma/);

  // Search by whitespace-padded address & moniker
  const searchInput = findAll(f.container, (el) => el.type === 'input')[0];
  searchInput.props['onUpdate:modelValue']('  GAMMA  ');
  await nextTick();
  assert.equal(rows(f.container).length, 1);
  assert.match(rows(f.container)[0], /gamma/);

  searchInput.props['onUpdate:modelValue']('firmavaloper1beta');
  await nextTick();
  assert.equal(rows(f.container).length, 1);
  assert.match(rows(f.container)[0], /Beta/);

  // Delegate action still works
  const delegateBtn = findAll(f.container, (el) => el.props.for === 'delegate')[0];
  click(delegateBtn);
  assert.deepEqual(f.actions[0], ['delegate', { validator_address: 'firmavaloper1beta' }]);

  // Empty search result
  searchInput.props['onUpdate:modelValue']('nonexistent-validator');
  await nextTick();
  assert.match(text(f.container), /No matching validators found/);
});

test('marks partial validator list warning when a page fails instead of claiming search is complete', async (t) => {
  const v1 = makeValidator('One', 'firmavaloper1one', '1000000');
  const f = await createStakingListFixture(t, {
    bondedPages: [{ validators: [v1], pagination: { next_key: 'p2' } }],
    failPage2: true,
  });

  assert.equal(f.staking.validatorsComplete.BOND_STATUS_BONDED, false);
  assert.match(text(f.container), /Validator list may be partial.*HTTP 503 page 2/);
});
