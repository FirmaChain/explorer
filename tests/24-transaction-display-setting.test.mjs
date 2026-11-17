import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, text } from './helpers/validator-renderer.mjs';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

async function createTxListFixture(t, { storageInitial = {}, txs = [] } = {}) {
  const originalStorage = globalThis.localStorage;
  const originalDoc = globalThis.document;
  const storage = makeStorage(storageInitial);
  globalThis.localStorage = storage;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  });

  const base = reactive({
    fetchAllBlocks: false,
    missingHeights: [],
    windowLimit: 50,
    isContiguous: false,
    txsInRecents: txs,
  });
  const blockchain = reactive({
    chainName: 'firmachain',
    current: { chainName: 'firmachain', assets: [] },
  });

  const addresses = await loadProduct('src/libs/address.ts');
  setActivePinia(createPinia());
  const stores = {
    useBaseStore: () => base,
    useBlockchain: () => blockchain,
    useStakingStore: () => ({ validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const page = (
    await loadProduct('src/modules/[chain]/tx/index.vue', {
      '@/stores': stores,
      'vue-router': {
        useRouter: () => ({
          currentRoute: { value: { query: {} } },
          push: () => {},
        }),
      },
    })
  ).default;

  const props = reactive({ chain: 'firmachain' });
  const mounted = mount(page, props);
  t.after(() => mounted.app.unmount());
  return { ...mounted, props, base, blockchain, storage };
}

test('defaults to compact mode, toggles to detailed mode with real cached fields only, persists, and falls back on invalid storage', async (t) => {
  const sampleTx = {
    height: '42',
    hash: 'ABCD'.repeat(16),
    tx: {
      body: {
        memo: 'memo-cached',
        messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend' }],
      },
      authInfo: {
        signerInfos: [{ sequence: '1' }],
        fee: {
          gasLimit: '200000',
          amount: [{ denom: 'ufct', amount: '5000' }],
        },
      },
    },
  };

  const f = await createTxListFixture(t, {
    storageInitial: { 'explorer:txDisplayMode': 'bogus' },
    txs: [sampleTx],
  });

  // Compact mode is default and omits memo / gasLimit columns
  assert.doesNotMatch(text(f.container), /memo-cached/);
  assert.doesNotMatch(text(f.container), /Gas Limit: 200000/);

  click(button(f.container, 'Detailed'));
  await nextTick();

  assert.equal(f.storage.dump()['explorer:txDisplayMode'], 'detailed');
  assert.match(text(f.container), /Signers: 1/);
  assert.match(text(f.container), /Gas Limit: 200000/);
  assert.match(text(f.container), /memo-cached/);
  assert.match(text(f.container), /MsgSend/);
  assert.match(
    text(f.container),
    /Status and execution timestamp are available on each transaction's detail page/
  );

  // Chain mismatch clears table rather than showing previous chain txs
  f.props.chain = 'otherchain';
  await nextTick();
  assert.match(text(f.container), /No recent cached transactions/);

  // Simulated reload restores 'detailed' mode
  const reloaded = await createTxListFixture(t, {
    storageInitial: { 'explorer:txDisplayMode': 'detailed' },
    txs: [sampleTx],
  });
  assert.match(text(reloaded.container), /Gas Limit: 200000/);
  assert.equal(findAll(reloaded.container, (el) => el.type === 'a').length > 0, true);
});
