import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { h, nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, rows, text } from './helpers/validator-renderer.mjs';

function makeSigner(seed, moniker, power, identity = '') {
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
      description: { moniker, identity },
      consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
    },
  };
}

async function createSignatureFixture(t, { height = 50, latestHeight = 100, blockHandlers, valsetHandler, stakingValidators, keybase } = {}) {
  const s1 = makeSigner(1, 'Validator-One', 60, 'ID_1');
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
  const validatorAvatar = await loadProduct('src/libs/validatorAvatar.ts');
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

  const stakingStore = reactive({
    validators: stakingValidators || [s1.staking, s2.staking, s3.staking],
    keybase:
      keybase ||
      (async (identity) => ({
        them: [{ pictures: { primary: { url: `https://img.example/${identity}.png` } } }],
      })),
  });

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => stakingStore,
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
      '@/libs/address': addresses,
      '@/libs/blockSignatures': sigLib,
      '@/libs/validatorAvatar': validatorAvatar,
      '@iconify/vue': {
        Icon: (p) => h('span', { 'data-icon': p.icon }),
      },
    })
  ).default;

  const props = reactive({ height, chain: 'firmachain', latestHeight });
  const mounted = mount(component, props);
  t.after(() => mounted.app.unmount());

  return { ...mounted, props, blockchain, stakingStore, requestedBlockHeights, signers: { s1, s2, s3 } };
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

test('paginates block signatures 10 rows per page', async (t) => {
  const manySigners = Array.from({ length: 25 }, (_, i) =>
    makeSigner(i + 1, `Val-${String(i + 1).padStart(2, '0')}`, 10)
  );
  const f = await createSignatureFixture(t, {
    height: 10,
    latestHeight: 50,
    stakingValidators: manySigners.map((s) => s.staking),
    blockHandlers: async (h) => ({
      block_id: { hash: `HASH-${h}` },
      block: {
        header: { height: String(h), chain_id: 'firmachain-1', time: '2026-11-17T00:00:00Z' },
        last_commit: {
          height: String(Number(h) - 1),
          round: 0,
          signatures: manySigners.map((s) => ({
            block_id_flag: 'BLOCK_ID_FLAG_COMMIT',
            validator_address: s.b64,
            timestamp: '2026-11-17T00:00:01Z',
            signature: 'sig',
          })),
        },
      },
    }),
    valsetHandler: async (h) => ({
      block_height: String(h),
      validators: manySigners.map((s) => s.tm),
      pagination: {},
    }),
  });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(rows(f.container).length, 10);
  assert.match(rows(f.container)[0], /Val-01/);
  assert.match(rows(f.container)[9], /Val-10/);
  assert.match(text(f.container), /Page 1 \/ 3/);
  assert.equal(button(f.container, 'Previous').props.disabled, true);
  assert.equal(button(f.container, 'Next').props.disabled, false);

  click(button(f.container, 'Next'));
  await nextTick();
  assert.equal(rows(f.container).length, 10);
  assert.match(rows(f.container)[0], /Val-11/);
  assert.match(text(f.container), /Page 2 \/ 3/);

  click(button(f.container, 'Next'));
  await nextTick();
  assert.equal(rows(f.container).length, 5);
  assert.match(rows(f.container)[0], /Val-21/);
  assert.match(text(f.container), /Page 3 \/ 3/);
  assert.equal(button(f.container, 'Next').props.disabled, true);

  click(button(f.container, 'Previous'));
  await nextTick();
  assert.match(text(f.container), /Page 2 \/ 3/);
});

test('does not re-fetch historical block signatures when latestHeight advances, and loads pending_next once', async (t) => {
  const f = await createSignatureFixture(t, { height: 100, latestHeight: 100 });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  // At latest height 100, H+1 is not available yet
  assert.equal(f.requestedBlockHeights.length, 0);
  assert.match(text(f.container), /Waiting for block #101/);

  // Block 101 arrives -> loads signatures for #100 once
  f.props.latestHeight = 101;
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.deepEqual(f.requestedBlockHeights, [101]);
  assert.match(text(f.container), /Validator-OneSigned60/);

  // Subsequent new blocks (102, 103) must NOT reset or re-fetch finalized #100
  f.props.latestHeight = 102;
  await nextTick();
  assert.doesNotMatch(text(f.container), /Loading block signatures/);
  f.props.latestHeight = 103;
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.deepEqual(f.requestedBlockHeights, [101]);
});

test('renders validator avatar logos with fallback icon, lazy-loads per page, and enriches late staking validators', async (t) => {
  const keybaseCalls = [];
  const signers = Array.from({ length: 12 }, (_, i) =>
    makeSigner(i + 1, `Val-${i + 1}`, 10, `ID-${i + 1}`)
  );

  // Start with empty stakingStore.validators to also verify reactive enrichment
  const f = await createSignatureFixture(t, {
    height: 10,
    latestHeight: 50,
    stakingValidators: [],
    keybase: async (identity) => {
      keybaseCalls.push(identity);
      return {
        them: [{ pictures: { primary: { url: `https://img.example/${identity}.png` } } }],
      };
    },
    blockHandlers: async (h) => ({
      block_id: { hash: `HASH-${h}` },
      block: {
        header: { height: String(h), chain_id: 'firmachain-1', time: '2026-11-17T00:00:00Z' },
        last_commit: {
          height: String(Number(h) - 1),
          round: 0,
          signatures: signers.map((s) => ({
            block_id_flag: 'BLOCK_ID_FLAG_COMMIT',
            validator_address: s.b64,
            timestamp: '2026-11-17T00:00:01Z',
            signature: 'sig',
          })),
        },
      },
    }),
    valsetHandler: async (h) => ({
      block_height: String(h),
      validators: signers.map((s) => s.tm),
      pagination: {},
    }),
  });

  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  // Before staking validators load, fallback icons render
  assert.equal(
    findAll(f.container, (el) => el.props['data-icon'] === 'mdi-help-circle-outline').length,
    10
  );
  assert.equal(keybaseCalls.length, 0);

  // Staking validators arrive -> enriches page 1 (10 items) and fetches only page 1 avatars
  f.stakingStore.validators = signers.map((s) => s.staking);
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(keybaseCalls.length, 10);
  assert.equal(
    findAll(f.container, (el) => el.type === 'img' && el.props.src === 'https://img.example/ID-1.png').length,
    1
  );

  // Navigating to page 2 loads avatars for page 2 (ID-11, ID-12)
  click(button(f.container, 'Next'));
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(keybaseCalls.length, 12);
  assert.equal(
    findAll(f.container, (el) => el.type === 'img' && el.props.src === 'https://img.example/ID-11.png').length,
    1
  );
  assert.equal(
    findAll(f.container, (el) => el.type === 'img' && el.props.src === 'https://img.example/ID-12.png').length,
    1
  );
});
