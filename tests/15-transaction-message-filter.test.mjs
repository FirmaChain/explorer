import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { h, nextTick, reactive } from 'vue';
import { toBase64 } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, text } from './helpers/validator-renderer.mjs';

async function createTxFixture(t, txByHash) {
  const pushed = [];
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: { assets: [] },
    rpc: {
      getTx: async (hash) => txByHash(hash),
    },
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
      '@/components/dynamic/DynamicComponent.vue': {
        default: (p) => h('div', { 'data-dynamic': '1' }, JSON.stringify(p.value)),
      },
      '@/components/JsonTree.vue': { default: () => null },
      'vue-router': { useRouter: () => ({ push: (to) => pushed.push(to) }) },
    })
  ).default;

  const originalDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  });

  const props = reactive({ hash: 'A'.repeat(64), chain: 'firmachain' });
  const mounted = mount(page, props);
  t.after(() => mounted.app.unmount());
  return { ...mounted, props, blockchain, pushed };
}

test('filters mixed/repeated/unknown messages, toggles structured/raw without mutating original response, and resets on hash change', async (t) => {
  const originalPacketMsg = {
    '@type': '/ibc.core.channel.v1.MsgRecvPacket',
    packet: { data: toBase64(Buffer.from('hello-ibc')) },
  };
  const txOne = {
    tx: {
      body: {
        memo: 'm1',
        messages: [
          { '@type': '/cosmos.bank.v1beta1.MsgSend', amount: [] },
          { '@type': '/cosmos.bank.v1beta1.MsgSend', amount: [] },
          originalPacketMsg,
          { '@type': '/cosmos.authz.v1beta1.MsgExec', msgs: [{ '@type': '/cosmos.staking.v1beta1.MsgDelegate' }] },
          { foo: 'bar' },
        ],
      },
      auth_info: { fee: { amount: [] } },
    },
    tx_response: {
      txhash: 'A'.repeat(64),
      height: '100',
      code: 0,
      raw_log: '',
      logs: [],
      events: [],
      timestamp: '2026-11-17T00:00:00Z',
      gas_used: '10',
      gas_wanted: '20',
    },
  };
  const txTwo = {
    tx: {
      body: { memo: 'm2', messages: [] },
      auth_info: { fee: { amount: [] } },
    },
    tx_response: {
      ...txOne.tx_response,
      txhash: 'B'.repeat(64),
    },
  };

  const f = await createTxFixture(t, async (hash) => {
    if (hash === 'B'.repeat(64)) return txTwo;
    return txOne;
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  // Original object must NOT have been mutated with .message
  assert.equal('message' in originalPacketMsg, false);

  const msgSection = () =>
    findAll(f.container, (el) => el.props['data-tx-messages'] !== undefined)[0];
  assert.match(text(msgSection()), /\(5\/5\)/);
  assert.match(text(msgSection()), /nested: MsgDelegate/);

  // Filter to MsgSend (2 items)
  const select = findAll(msgSection(), (el) => el.type === 'select')[0];
  select.props['onUpdate:modelValue']('/cosmos.bank.v1beta1.MsgSend');
  await nextTick();
  assert.match(text(msgSection()), /\(2\/5\)/);

  // Switch to Raw view
  click(button(msgSection(), 'Raw'));
  await nextTick();
  assert.match(text(msgSection()), /"\/cosmos\.bank\.v1beta1\.MsgSend"/);

  // Switch hash -> resets filter to All and view mode to Structured, handles empty messages
  f.props.hash = 'B'.repeat(64);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(msgSection()), /\(0\/0\)/);
  assert.match(text(msgSection()), /tx\.no_messages/);
});

test('handles transaction lookup error cleanly', async (t) => {
  const f = await createTxFixture(t, async () => {
    throw new Error('HTTP 404 tx not found');
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(f.container), /Could not load transaction.*HTTP 404 tx not found/);
});
