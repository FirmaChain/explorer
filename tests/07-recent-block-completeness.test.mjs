import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { toBase64 } from '@cosmjs/encoding';
import { Tx, TxBody, AuthInfo, Fee } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { loadProduct, root } from './helpers/validator-renderer.mjs';

function makeRawTx(memo) {
  const bytes = Tx.encode(
    Tx.fromPartial({
      body: TxBody.fromPartial({ memo, messages: [] }),
      authInfo: AuthInfo.fromPartial({ fee: Fee.fromPartial({ amount: [] }) }),
      signatures: [],
    })
  ).finish();
  return toBase64(bytes);
}

function makeBlock(height, chainId = 'firmachain-1', txs = [], hash = `H-${height}`) {
  return {
    block_id: { hash },
    block: {
      header: {
        chain_id: chainId,
        height: String(height),
        time: `2026-11-17T00:00:${String(height % 60).padStart(2, '0')}Z`,
        proposer_address: '',
      },
      data: { txs },
    },
  };
}

async function createBaseStoreFixture(t, rpcImpl) {
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    rpc: rpcImpl,
  });

  setActivePinia(createPinia());
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null } };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { disabled: true },
    resolve: { alias: { '@': `${root}src` } },
    plugins: [
      {
        name: 'base-store-test-boundaries',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@/stores' || id === `${root}src/stores`) {
            return '\0test-stores';
          }
        },
        load(id) {
          if (id === '\0test-stores') {
            return 'export function useBlockchain() { return globalThis.__TEST_BLOCKCHAIN__; }';
          }
        },
      },
    ],
  });
  t.after(async () => {
    delete globalThis.__TEST_BLOCKCHAIN__;
    await vite.close();
  });
  globalThis.__TEST_BLOCKCHAIN__ = blockchain;

  const { useBaseStore } = await vite.ssrLoadModule('/src/stores/useBaseStore.ts');
  return { store: useBaseStore(), blockchain };
}

test('default fetchAllBlocks=false keeps sampling behavior and never claims continuity', async (t) => {
  let latestHeight = 10;
  const fetchedHeights = [];
  const { store } = await createBaseStoreFixture(t, {
    getBaseBlockLatest: async () => makeBlock(latestHeight),
    getBaseBlockAt: async (h) => {
      fetchedHeights.push(Number(h));
      return makeBlock(Number(h));
    },
  });

  store.fetchAllBlocks = false;
  await store.fetchLatest();
  latestHeight = 15;
  await store.fetchLatest();

  assert.deepEqual(fetchedHeights, []);
  assert.deepEqual(
    store.recents.map((b) => Number(b.block.header.height)),
    [10, 15]
  );
  assert.equal(store.isContiguous, false);
});

test('fetchAllBlocks=true bounds backfill to [max(1, L-W+1), L], retries gaps, deduplicates txs, and rejects conflicts', async (t) => {
  const fetched = [];
  let failHeight98 = true;
  let corruptHeight97 = false;
  let latestHeight = 100;
  const tx98 = makeRawTx('missing-block-tx');

  const { store } = await createBaseStoreFixture(t, {
    getBaseBlockLatest: async () => makeBlock(latestHeight),
    getBaseBlockAt: async (h) => {
      const n = Number(h);
      fetched.push(n);
      if (n === 98 && failHeight98) throw new Error('HTTP 503');
      if (n === 97 && corruptHeight97) return makeBlock(97, 'firmachain-1', [], 'DIFFERENT-HASH');
      if (n === 98) return makeBlock(98, 'firmachain-1', [tx98]);
      return makeBlock(n);
    },
  });

  store.fetchAllBlocks = true;
  store.windowLimit = 5;
  // Seed an old stale block at height 10 to prove we do NOT scan 11..95
  store.recents = [makeBlock(10)];

  await store.fetchLatest();
  // Window is [96..100]; 100 came from latest, so only 96..99 are backfilled
  assert.deepEqual(fetched.sort((a, b) => a - b), [96, 97, 98, 99]);
  assert.deepEqual(store.missingHeights, [98]);
  assert.equal(store.isContiguous, false);

  // Next poll recovers 98 and makes window contiguous
  fetched.length = 0;
  failHeight98 = false;
  await store.fetchLatest();
  assert.deepEqual(fetched, [98]);
  assert.deepEqual(store.missingHeights, []);
  assert.equal(store.isContiguous, true);
  assert.deepEqual(
    store.recents.map((b) => Number(b.block.header.height)),
    [96, 97, 98, 99, 100]
  );
  // Transaction from backfilled block 98 appears exactly once
  assert.equal(store.txsInRecents.length, 1);
  assert.equal(store.txsInRecents[0].height, '98');

  // Re-polling does not duplicate tx98
  await store.fetchLatest();
  assert.equal(store.txsInRecents.length, 1);

  // Conflicting hash on height 97 is rejected rather than silently merged
  corruptHeight97 = true;
  const { mergeRecentBlocks } = await loadProduct('src/libs/recentBlocks.ts', {
    '@/types': await loadProduct('src/types/common.ts'),
  });
  const conflict = mergeRecentBlocks(
    store.recents,
    [makeBlock(97, 'firmachain-1', [], 'CONFLICT-HASH')],
    5,
    100,
    'firmachain-1'
  );
  assert.deepEqual(conflict.conflicts, [97]);
  assert.deepEqual(conflict.missingHeights, [97]);
});

test('endpoint switch resets cache and discards overlapping/late poll responses even with identical chain_id', async (t) => {
  let resolveFirst;
  let call = 0;

  const { store, blockchain } = await createBaseStoreFixture(t, {
    getBaseBlockLatest: () => {
      call += 1;
      if (call === 1) {
        return new Promise((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve(makeBlock(200, 'firmachain-1', [], 'EP2-200'));
    },
    getBaseBlockAt: async (h) => makeBlock(Number(h), 'firmachain-1', [], `EP2-${h}`),
  });

  store.fetchAllBlocks = true;
  store.windowLimit = 3;

  const firstPoll = store.fetchLatest();
  // Switch endpoint (same chainName and same chain_id) while firstPoll is in flight
  blockchain.endpoint = { address: 'https://node-b.example' };
  await store.fetchLatest();
  assert.equal(store.latest.block_id.hash, 'EP2-200');

  // Late response from old endpoint must be discarded
  resolveFirst(makeBlock(999, 'firmachain-1', [], 'OLD-EP1-999'));
  await firstPoll;
  assert.equal(store.latest.block_id.hash, 'EP2-200');
});
