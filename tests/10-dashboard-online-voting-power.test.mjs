import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, text } from './helpers/validator-renderer.mjs';

function makeVal(seed, power) {
  const pub = Buffer.alloc(32, seed);
  const bytes = sha256(pub).slice(0, 20);
  return {
    b64: toBase64(bytes),
    tm: {
      address: toHex(bytes).toUpperCase(),
      pub_key: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
      voting_power: String(power),
      proposer_priority: '0',
    },
  };
}

test('computes commit-signed online voting power across paginated validator set and rejects incomplete/zero denominator', async (t) => {
  const v1 = makeVal(1, 70);
  const v2 = makeVal(2, 30);
  let mode = 'multi';

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const blockSigs = await loadProduct('src/libs/blockSignatures.ts', {
    '@/libs/address': addresses,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });
  const metrics = await loadProduct('src/libs/dashboardMetrics.ts', {
    'cross-fetch': fetch,
    '@/libs/address': addresses,
    '@/libs/blockSignatures': blockSigs,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  const baseStore = reactive({
    latest: {
      block: {
        header: { height: '501', chain_id: 'firmachain-1' },
        last_commit: {
          height: '500',
          signatures: [
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
            { block_id_flag: 'BLOCK_ID_FLAG_ABSENT', validator_address: v2.b64 },
          ],
        },
      },
    },
  });
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    rpc: {
      getBaseValidatorsetAt: async (h, _offset, page) => {
        if (mode === 'zero') {
          return { block_height: String(h), validators: [makeVal(1, 0).tm], pagination: {} };
        }
        if (mode === 'partial') {
          if (!page?.key) {
            return { block_height: String(h), validators: [v1.tm], pagination: { next_key: 'k2' } };
          }
          throw new Error('page 2 failed');
        }
        if (!page?.key) {
          return { block_height: String(h), validators: [v1.tm], pagination: { next_key: 'k2' } };
        }
        return { block_height: String(h), validators: [v2.tm], pagination: {} };
      },
    },
  });

  const comp = (
    await loadProduct('src/components/DashboardVotingPower.vue', {
      '@/stores': {
        useBaseStore: () => baseStore,
        useBlockchain: () => blockchain,
        useStakingStore: () => ({ validators: [] }),
      },
      '@/libs/dashboardMetrics': metrics,
    })
  ).default;

  const mounted = mount(comp, reactive({ chain: 'firmachain' }));
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.match(text(mounted.container), /70\.00%/);
  assert.match(text(mounted.container), /70 \/ 100/);
  assert.match(text(mounted.container), /1 \/ 2/);
  const progressBars = findAll(
    mounted.container,
    (el) => el.props.role === 'progressbar'
  );
  assert.equal(progressBars.length, 1);
  assert.equal(progressBars[0].props['aria-valuenow'], 70);

  // Updating block commit height with the same validators (< 60s TTL) reuses cache with 0 RPC calls
  let valsetCalls = 0;
  const origGet = blockchain.rpc.getBaseValidatorsetAt;
  blockchain.rpc.getBaseValidatorsetAt = () => {
    valsetCalls += 1;
    return origGet();
  };
  baseStore.latest = {
    block: {
      header: { height: '502', chain_id: 'firmachain-1' },
      last_commit: {
        height: '501',
        signatures: [
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v2.b64 },
        ],
      },
    },
  };
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(valsetCalls, 0);
  assert.doesNotMatch(text(mounted.container), /Loading online voting power/);
  assert.match(text(mounted.container), /100\.00%/);
  assert.doesNotMatch(text(mounted.container), /height #/);

  // When a new validator appears in signatures, re-fetches immediately without flashing Loading state
  const v3 = makeVal(3, 50);
  let resolveNextBlock;
  blockchain.rpc.getBaseValidatorsetAt = () => {
    valsetCalls += 1;
    return new Promise((resolve) => {
      resolveNextBlock = resolve;
    });
  };
  baseStore.latest = {
    block: {
      header: { height: '503', chain_id: 'firmachain-1' },
      last_commit: {
        height: '502',
        signatures: [
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v2.b64 },
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v3.b64 },
        ],
      },
    },
  };
  await nextTick();
  await nextTick();
  assert.equal(valsetCalls, 1);
  assert.doesNotMatch(text(mounted.container), /Loading online voting power/);
  assert.match(text(mounted.container), /100\.00%/);
  resolveNextBlock({ block_height: '502', validators: [v1.tm, v2.tm, v3.tm], pagination: {} });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /3 \/ 3/);
  assert.doesNotMatch(text(mounted.container), /height #/);
  blockchain.rpc.getBaseValidatorsetAt = origGet;

  mode = 'partial';
  blockchain.endpoint = { address: 'https://node-b.example' };
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /Online voting power unavailable: page 2 failed/);

  mode = 'zero';
  blockchain.endpoint = { address: 'https://node-c.example' };
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /Online voting power unavailable/);
});

test('reuses cached validator set across blocks within 60s and invalidates on TTL expiry or new signer', async () => {
  const v1 = makeVal(1, 60);
  const v2 = makeVal(2, 40);
  const v3 = makeVal(3, 50);

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const blockSigs = await loadProduct('src/libs/blockSignatures.ts', {
    '@/libs/address': addresses,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });
  const metrics = await loadProduct('src/libs/dashboardMetrics.ts', {
    'cross-fetch': fetch,
    '@/libs/address': addresses,
    '@/libs/blockSignatures': blockSigs,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  let currentTime = 1_000_000;
  let activeSet = [v1.tm, v2.tm];
  let calls = 0;
  const rpc = {
    getBaseValidatorsetAt: async (h) => {
      calls += 1;
      return { block_height: String(h), validators: activeSet, pagination: {} };
    },
  };
  const cache = { current: null };
  const opts = { cache, ttlMs: 60_000, now: () => currentTime };

  const r1 = await metrics.computeOnlineVotingPower(
    rpc,
    {
      block: {
        header: { height: '101' },
        last_commit: {
          height: '100',
          signatures: [
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v2.b64 },
          ],
        },
      },
    },
    [],
    opts
  );
  assert.equal(calls, 1);
  assert.equal(r1.signedPercent, '100.00%');

  // 30s later, validator 2 goes absent -> recomputes immediately without RPC call
  currentTime += 30_000;
  const r2 = await metrics.computeOnlineVotingPower(
    rpc,
    {
      block: {
        header: { height: '102' },
        last_commit: {
          height: '101',
          signatures: [
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
            { block_id_flag: 'BLOCK_ID_FLAG_ABSENT', validator_address: '' },
          ],
        },
      },
    },
    [],
    opts
  );
  assert.equal(calls, 1);
  assert.equal(r2.signedPercent, '60.00%');
  assert.equal(r2.signedValidators, 1);
  assert.equal(r2.totalValidators, 2);

  // 60s expires -> refreshes validator set via RPC
  currentTime += 30_000;
  activeSet = [v1.tm, v2.tm, v3.tm];
  const r3 = await metrics.computeOnlineVotingPower(
    rpc,
    {
      block: {
        header: { height: '103' },
        last_commit: {
          height: '102',
          signatures: [
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
            { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v2.b64 },
          ],
        },
      },
    },
    [],
    opts
  );
  assert.equal(calls, 2);
  assert.equal(r3.signedPower, 100n);
  assert.equal(r3.totalPower, 150n);
});

test('fetches latest block once immediately on initial render when baseStore.latest is empty', async (t) => {
  const v1 = makeVal(1, 80);
  const v2 = makeVal(2, 20);

  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const blockSigs = await loadProduct('src/libs/blockSignatures.ts', {
    '@/libs/address': addresses,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });
  const metrics = await loadProduct('src/libs/dashboardMetrics.ts', {
    'cross-fetch': fetch,
    '@/libs/address': addresses,
    '@/libs/blockSignatures': blockSigs,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  let latestCalls = 0;
  let valsetCalls = 0;
  const latestBlockPayload = {
    block: {
      header: { height: '701', chain_id: 'firmachain-1' },
      last_commit: {
        height: '700',
        signatures: [
          { block_id_flag: 'BLOCK_ID_FLAG_COMMIT', validator_address: v1.b64 },
          { block_id_flag: 'BLOCK_ID_FLAG_ABSENT', validator_address: v2.b64 },
        ],
      },
    },
  };

  const baseStore = reactive({ latest: {} });
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    rpc: {
      getBaseBlockLatest: async () => {
        latestCalls += 1;
        return latestBlockPayload;
      },
      getBaseValidatorsetAt: async (h) => {
        valsetCalls += 1;
        return { block_height: String(h), validators: [v1.tm, v2.tm], pagination: {} };
      },
    },
  });

  const comp = (
    await loadProduct('src/components/DashboardVotingPower.vue', {
      '@/stores': {
        useBaseStore: () => baseStore,
        useBlockchain: () => blockchain,
        useStakingStore: () => ({ validators: [] }),
      },
      '@/libs/dashboardMetrics': metrics,
    })
  ).default;

  const mounted = mount(comp, reactive({ chain: 'firmachain' }));
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(latestCalls, 1);
  assert.equal(valsetCalls, 1);
  assert.match(text(mounted.container), /80\.00%/);
  assert.match(text(mounted.container), /80 \/ 100/);
  assert.doesNotMatch(text(mounted.container), /height #/);

  // When baseStore.latest later hydrates with the same commit height, avoid duplicate requests
  baseStore.latest = latestBlockPayload;
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(latestCalls, 1);
  assert.equal(valsetCalls, 1);
});
