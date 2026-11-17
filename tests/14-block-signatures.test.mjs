import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, rows, text } from './helpers/validator-renderer.mjs';

function makeSigner(seed, moniker, power) {
  const pub = Buffer.alloc(32, seed);
  const bytes = sha256(pub).slice(0, 20);
  const hex = toHex(bytes).toUpperCase();
  const b64 = toBase64(bytes);
  return {
    hex,
    b64,
    tm: {
      address: hex,
      pub_key: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
      voting_power: String(power),
      proposer_priority: '0',
    },
    staking: {
      operator_address: `firmavaloper1v${seed}`,
      description: { moniker },
      consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
    },
  };
}

async function createSignatureFixture(t, { height = 50, latestHeight = 100, blockHandlers, valsetHandler } = {}) {
  const s1 = makeSigner(1, 'Validator-One', 60);
  const s2 = makeSigner(2, 'Validator-Two', 25);
  const s3 = makeSigner(3, 'Validator-Three', 15);

  const requestedBlockHeights = [];
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: { assets: [] },
    rpc: {
      getBaseBlockAt: async (h) => {
        requestedBlockHeights.push(Number(h));
        if (blockHandlers) return blockHandlers(Number(h), { s1, s2, s3 });
        return {
          block_id: { hash: `HASH-${h}` },
          block: {
            header: { height: String(h), chain_id: 'firmachain-1', time: '2026-11-17T00:00:00Z' },
            last_commit: {
              height: String(Number(h) - 1),
              round: 0,
              signatures: [
                { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: s1.b64, timestamp: '2026-11-17T00:00:01Z', signature: 'sig1' },
                { block_id_flag: 'BLOCK_ID_FLAG_NIL', validator_address: s2.b64, timestamp: '2026-11-17T00:00:01Z', signature: '' },
                { block_id_flag: 'BLOCK_ID_FLAG_ABSENT', validator_address: '', timestamp: '', signature: '' },
              ],
            },
          },
        };
      },
      getBaseValidatorsetAt: async (h, _offset, page) => {
        if (valsetHandler) return valsetHandler(Number(h), page, { s1, s2, s3 });
        return {
          block_height: String(h),
          validators: [s1.tm, s2.tm, s3.tm],
          pagination: {},
        };
      },
    },
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const sigLib = await loadProduct('src/libs/blockSignatures.ts', {
    '@/libs/address': addresses,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => ({ validators: [s1.staking, s2.staking, s3.staking] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const component = (
    await loadProduct('src/components/BlockSignatures.vue', {
      '@/stores': stores,
      '@/libs/blockSignatures': sigLib,
    })
  ).default;

  const props = reactive({ height, chain: 'firmachain', latestHeight });
  const mounted = mount(component, props);
  t.after(() => mounted.app.unmount());

  return { ...mounted, props, blockchain, requestedBlockHeights, signers: { s1, s2, s3 } };
}

test('fetches H+1 last_commit and H validator set to display Signed/Nil/Absent statuses and exact voting power', async (t) => {
  const f = await createSignatureFixture(t, { height: 1, latestHeight: 10 });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  // Proof that height H=1 queries block H+1 (height 2), not H's own last_commit
  assert.deepEqual(f.requestedBlockHeights, [2]);
  assert.match(text(f.container), /Block #1 Signatures/);
  assert.match(text(f.container), /Commit signatures recorded in block #2 \(last_commit for height #1\)/);
  assert.match(text(f.container), /Signed: 1.*Nil: 1.*Absent: 1/);
  assert.match(text(f.container), /Signed Voting Power: 60 \/ 100/);
  assert.equal(rows(f.container).length, 3);
  assert.match(rows(f.container)[0], /Validator-OneSigned60/);
  assert.match(rows(f.container)[1], /Validator-TwoNil25/);
  assert.match(rows(f.container)[2], /Validator-ThreeAbsent15/);
});

test('shows waiting state for latest block where H+1 does not yet exist', async (t) => {
  const f = await createSignatureFixture(t, { height: 100, latestHeight: 100 });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(f.requestedBlockHeights.length, 0);
  assert.match(text(f.container), /Waiting for block #101 to confirm signatures for block #100/);
});

test('handles pruned/failed validator set without fabricating voting power and exposes error on block fetch failure', async (t) => {
  const pruned = await createSignatureFixture(t, {
    height: 50,
    latestHeight: 100,
    valsetHandler: async () => {
      throw new Error('height 50 is pruned');
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(pruned.container), /Validator set mapping\/voting power unavailable: height 50 is pruned/);
  assert.match(text(pruned.container), /Signed Voting Power: Unavailable/);

  const errored = await createSignatureFixture(t, {
    height: 50,
    latestHeight: 100,
    blockHandlers: async () => {
      throw new Error('HTTP 503');
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(errored.container), /Could not load signatures for block #50\. HTTP 503/);
  assert.equal(findAll(errored.container, (el) => el.props.role === 'alert').length, 1);
});

test('unknown validator address in commit disables uncertain voting power calculation', async (t) => {
  const unknownHex = 'AABBCCDDEEFF00112233445566778899AABBCCDD';
  const f = await createSignatureFixture(t, {
    height: 20,
    latestHeight: 50,
    blockHandlers: async (h) => ({
      block_id: { hash: `H-${h}` },
      block: {
        header: { height: String(h), chain_id: 'firmachain-1', time: '2026-11-17T00:00:00Z' },
        last_commit: {
          height: '20',
          signatures: [
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: unknownHex, timestamp: '2026-11-17T00:00:01Z', signature: 'sig' },
          ],
        },
      },
    }),
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(f.container), new RegExp(unknownHex));
  assert.match(text(f.container), /Signed Voting Power: Unavailable/);
});
