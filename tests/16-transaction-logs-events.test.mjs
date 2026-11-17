import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, text } from './helpers/validator-renderer.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function createLogsFixture(t, txByHash) {
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: { assets: [] },
    rpc: { getTx: async (hash) => txByHash(hash) },
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const txDetail = await loadProduct('src/libs/txDetail.ts', { '@/types': types });

  setActivePinia(createPinia());
  const stores = {
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
    await loadProduct('src/modules/[chain]/tx/[hash].vue', {
      '@/stores': stores,
      '@/libs/txDetail': txDetail,
      '@/components/dynamic/DynamicComponent.vue': { default: () => null },
      '@/components/JsonTree.vue': { default: () => null },
      'vue-router': { useRouter: () => ({ push: () => {} }) },
    })
  ).default;

  const originalDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  });

  const props = reactive({ hash: '1'.repeat(64), chain: 'firmachain' });
  const mounted = mount(page, props);
  t.after(() => mounted.app.unmount());
  return { ...mounted, props };
}

test('separates logs and events, handles logs-only, events-only, failed raw_log, malformed fields, and raw toggles', async (t) => {
  const responses = {
    ['1'.repeat(64)]: {
      tx: { body: { memo: '', messages: [] }, auth_info: { fee: { amount: [] } } },
      tx_response: {
        txhash: '1'.repeat(64),
        height: '10',
        code: 0,
        raw_log: '',
        logs: [
          {
            msg_index: 0,
            log: 'ok <script>alert(1)</script>',
            events: [{ type: 'message', attributes: [{ key: 'action', value: 'send' }] }],
          },
        ],
        events: null, // logs-only
        timestamp: '2026-11-17T00:00:00Z',
        gas_used: '10',
        gas_wanted: '20',
      },
    },
    ['2'.repeat(64)]: {
      tx: { body: { memo: '', messages: [] }, auth_info: { fee: { amount: [] } } },
      tx_response: {
        txhash: '2'.repeat(64),
        height: '11',
        code: 0,
        raw_log: '',
        logs: [], // events-only (SDK v0.50 style)
        events: [{ type: 'transfer', attributes: [{ key: 'amount', value: '100ufct' }] }],
        timestamp: '2026-11-17T00:00:00Z',
        gas_used: '10',
        gas_wanted: '20',
      },
    },
    ['3'.repeat(64)]: {
      tx: { body: { memo: '', messages: [] }, auth_info: { fee: { amount: [] } } },
      tx_response: {
        txhash: '3'.repeat(64),
        height: '12',
        code: 5,
        raw_log: 'insufficient funds',
        logs: 'malformed-not-an-array',
        events: [null, { type: '', attributes: 'bad' }],
        timestamp: '2026-11-17T00:00:00Z',
        gas_used: '10',
        gas_wanted: '20',
      },
    },
  };

  const f = await createLogsFixture(t, async (hash) => responses[hash]);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  const logsBox = () => findAll(f.container, (el) => el.props['data-tx-logs'] !== undefined)[0];
  const eventsBox = () => findAll(f.container, (el) => el.props['data-tx-events'] !== undefined)[0];

  // Hash 1: logs-only
  assert.match(text(logsBox()), /Logs \(1\).*Message #0.*action:send/);
  assert.match(text(eventsBox()), /No events were provided in the transaction response/);

  // Hash 2: events-only
  f.props.hash = '2'.repeat(64);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(logsBox()), /No structured message logs were provided/);
  assert.match(text(eventsBox()), /Events \(1\).*transfer.*amount:100ufct/);
  click(button(eventsBox(), 'Raw Events'));
  await nextTick();
  assert.match(text(eventsBox()), /"key": "amount"/);
  assert.match(text(eventsBox()), /"value": "100ufct"/);

  // Hash 3: failed raw_log + malformed logs/events
  f.props.hash = '3'.repeat(64);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(logsBox()), /Execution failed raw_log: insufficient funds/);
  assert.match(text(eventsBox()), /#1 unknown/);
});

test('late response from previous tx hash cannot overwrite newly selected hash', async (t) => {
  const p1 = deferred();
  const p2 = deferred();
  const f = await createLogsFixture(t, (hash) =>
    hash === '1'.repeat(64) ? p1.promise : p2.promise
  );

  f.props.hash = '2'.repeat(64);
  await nextTick();
  p2.resolve({
    tx: { body: { memo: 'new', messages: [] }, auth_info: { fee: { amount: [] } } },
    tx_response: {
      txhash: '2'.repeat(64),
      height: '200',
      code: 0,
      raw_log: '',
      logs: [],
      events: [{ type: 'current_ev', attributes: [] }],
      timestamp: '2026-11-17T00:00:00Z',
      gas_used: '1',
      gas_wanted: '2',
    },
  });
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();

  p1.resolve({
    tx: { body: { memo: 'stale', messages: [] }, auth_info: { fee: { amount: [] } } },
    tx_response: {
      txhash: '1'.repeat(64),
      height: '100',
      code: 0,
      raw_log: '',
      logs: [],
      events: [{ type: 'stale_ev', attributes: [] }],
      timestamp: '2026-11-17T00:00:00Z',
      gas_used: '1',
      gas_wanted: '2',
    },
  });
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();

  assert.match(text(f.container), /current_ev/);
  assert.doesNotMatch(text(f.container), /stale_ev/);
});
