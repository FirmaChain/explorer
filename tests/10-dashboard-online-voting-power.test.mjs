import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { text } from './helpers/validator-renderer.mjs';

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

  // Updating block commit height on the SAME chain & endpoint must NOT flash Loading state
  let resolveNextBlock;
  const origGet = blockchain.rpc.getBaseValidatorsetAt;
  blockchain.rpc.getBaseValidatorsetAt = () =>
    new Promise((resolve) => {
      resolveNextBlock = resolve;
    });
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
  await nextTick();
  await nextTick();
  assert.doesNotMatch(text(mounted.container), /Loading online voting power/);
  assert.match(text(mounted.container), /70\.00%/);
  resolveNextBlock({ block_height: '501', validators: [v1.tm, v2.tm], pagination: {} });
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /100\.00%/);
  assert.match(text(mounted.container), /height #501/);
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
