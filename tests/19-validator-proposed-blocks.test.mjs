import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toBech32, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, rows, text } from './helpers/validator-renderer.mjs';

const pubkeyBytes = Buffer.alloc(32, 7);
const consensusBytes = sha256(pubkeyBytes).slice(0, 20);
const consensusHexUpper = toHex(consensusBytes).toUpperCase();
const consensusHexLower = consensusHexUpper.toLowerCase();
const consensusB64 = toBase64(consensusBytes);
const consensusValcons = toBech32('firmavalcons', consensusBytes);

const otherBytes = Buffer.alloc(20, 9);
const otherB64 = toBase64(otherBytes);

function block(height, proposer_address, time = '2026-11-17T10:00:00Z', chain_id = 'firmachain-1', txCount = 0) {
  return {
    block_id: { hash: `HASH-${height}` },
    block: {
      header: {
        chain_id,
        height: String(height),
        time,
        proposer_address,
      },
      data: {
        txs: Array.from({ length: txCount }, (_, i) => `tx-${i}`),
      },
    },
  };
}

async function createProposedFixture(t, initial = {}) {
  const blockchain = reactive({
    chainName: initial.chainName ?? 'firmachain',
    current: { assets: [] },
  });
  const baseStore = reactive({
    recents: initial.recents ?? [],
    currentChainId: initial.currentChainId ?? 'firmachain-1',
  });
  const stores = {
    useBlockchain: () => blockchain,
    useBaseStore: () => baseStore,
    useStakingStore: () => ({ validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {} }),
  };
  setActivePinia(createPinia());
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': {},
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const addresses = await loadProduct('src/libs/address.ts');
  const component = (
    await loadProduct('src/components/ValidatorProposedBlocks.vue', {
      '@/stores': stores,
      '@/libs': addresses,
    })
  ).default;

  const props = reactive({
    validator: 'firmavaloper1test',
    chain: initial.propChain ?? 'firmachain',
    consensusHex: initial.consensusHex ?? consensusHexUpper,
    loading: initial.loading ?? false,
    error: initial.error ?? '',
  });
  const mounted = mount(component, props);
  t.after(() => mounted.app.unmount());

  return {
    ...mounted,
    props,
    blockchain,
    baseStore,
    formatter: stores.useFormatter(),
  };
}

test('matches base64, hex (lower/0x) and valcons proposers, sorts descending, deduplicates, and flags non-contiguous scope', async (t) => {
  const f = await createProposedFixture(t, {
    recents: [
      block(100, consensusB64, '2026-11-17T10:00:00Z', 'firmachain-1', 2),
      block(100, consensusB64, '2026-11-17T10:00:00Z', 'firmachain-1', 2),
      block(101, otherB64, '2026-11-17T10:00:06Z', 'firmachain-1', 1),
      block(105, `0x${consensusHexLower}`, '2026-11-17T10:00:30Z', 'firmachain-1', 0),
      block(108, consensusValcons, '2026-11-17T10:00:48Z', 'firmachain-1', 3),
    ],
  });

  assert.match(text(f.container), /heights 100–108, 4 cached blocks, non-contiguous/);
  assert.match(text(f.container), /not the validator's complete historical block list/);
  assert.deepEqual(rows(f.container), [
    `1083${f.formatter.toDay('2026-11-17T10:00:48Z', 'short')}`,
    `1050${f.formatter.toDay('2026-11-17T10:00:30Z', 'short')}`,
    `1002${f.formatter.toDay('2026-11-17T10:00:00Z', 'short')}`,
  ]);
  assert.deepEqual(
    findAll(f.container, (el) => el.type === 'a').map((el) => el.props.href),
    ['/firmachain/block/108', '/firmachain/block/105', '/firmachain/block/100']
  );
});

test('handles empty cache, non-matching proposer, error, and validator/chain switches', async (t) => {
  const f = await createProposedFixture(t, { recents: [] });
  assert.match(text(f.container), /No recent cached blocks are available yet/);

  f.baseStore.recents = [block(50, otherB64)];
  await nextTick();
  assert.match(text(f.container), /No blocks in the recent cached window were proposed by this validator/);

  // Switch to a different validator consensus hex that matches block 50
  f.props.consensusHex = toHex(otherBytes).toLowerCase();
  await nextTick();
  assert.equal(rows(f.container).length, 1);

  // Chain mismatch hides stale cached blocks until chain matches
  f.props.chain = 'testnet';
  await nextTick();
  assert.match(text(f.container), /No recent cached blocks are available yet/);
  f.blockchain.chainName = 'testnet';
  await nextTick();
  assert.equal(rows(f.container).length, 1);

  // Error state surfaces alert without claiming empty
  f.props.error = 'HTTP 503';
  await nextTick();
  assert.match(text(f.container), /Could not resolve validator consensus address\. HTTP 503/);
  assert.equal(findAll(f.container, (el) => el.props.role === 'alert').length, 1);
});
