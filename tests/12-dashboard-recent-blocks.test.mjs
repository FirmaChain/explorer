import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { h, nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64 } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, rows, text } from './helpers/validator-renderer.mjs';

function block(h, chain_id = 'firmachain-1', proposer_address = '') {
  return {
    block_id: { hash: `H-${h}` },
    block: {
      header: {
        chain_id,
        height: String(h),
        time: `2026-11-17T00:00:${String(h % 60).padStart(2, '0')}Z`,
        proposer_address,
      },
      data: { txs: [] },
    },
  };
}

test('shows up to 7 latest unique blocks, handles empty/error/chain-switch, and preserves cache scope disclaimer', async (t) => {
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

  const pub = Buffer.alloc(32, 7);
  const proposerB64 = toBase64(sha256(pub).slice(0, 20));
  const validator = {
    operator_address: 'firmavaloper1proposer',
    description: { moniker: 'Alpha Validator', identity: 'ABC123' },
    consensus_pubkey: {
      '@type': '/cosmos.crypto.ed25519.PubKey',
      key: toBase64(pub),
    },
  };

  const baseStore = reactive({
    recents: [
      block(1),
      block(2),
      block(2), // duplicate
      block(5), // non-contiguous jump
      block(6),
      block(7),
      block(8),
      block(9),
      block(10, 'firmachain-1', proposerB64),
    ],
    currentChainId: 'firmachain-1',
    isContiguous: false,
    lastPollError: '',
  });
  const blockchain = reactive({
    chainName: 'firmachain',
    current: { assets: [] },
  });

  setActivePinia(createPinia());
  const stores = {
    useBaseStore: () => baseStore,
    useBlockchain: () => blockchain,
    useStakingStore: () => ({
      validators: [validator],
      keybase: async () => ({
        them: [{ pictures: { primary: { url: 'https://img.example/avatar.png' } } }],
      }),
    }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const comp = (
    await loadProduct('src/components/DashboardRecentBlocks.vue', {
      '@/stores': stores,
      '@/libs/dashboardMetrics': metrics,
      '@/libs/address': addresses,
      '@iconify/vue': {
        Icon: (p) => h('span', { 'data-icon': p.icon }),
      },
    })
  ).default;

  const props = reactive({ chain: 'firmachain' });
  const mounted = mount(comp, props);
  t.after(() => mounted.app.unmount());

  assert.equal(rows(mounted.container).length, 7);
  assert.match(rows(mounted.container)[0], /^10Alpha Validator/);
  assert.match(rows(mounted.container)[6], /^2-/);
  assert.equal(
    findAll(
      mounted.container,
      (el) => el.type === 'a' && el.props.href === '/firmachain/staking/firmavaloper1proposer'
    ).length,
    1
  );
  // Fallback icon rendered before keybase resolves, then avatar image after keybase lookup
  assert.equal(
    findAll(mounted.container, (el) => el.props['data-icon'] === 'mdi-help-circle-outline').length,
    1
  );
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.equal(
    findAll(
      mounted.container,
      (el) => el.type === 'img' && el.props.src === 'https://img.example/avatar.png'
    ).length,
    1
  );
  assert.match(text(mounted.container), /continuity not guaranteed/);
  assert.equal(
    findAll(mounted.container, (el) => el.type === 'a' && el.props.href === '/firmachain/block').length,
    1
  );

  // Chain switch mismatch hides stale chain blocks
  props.chain = 'testnet';
  await nextTick();
  assert.match(text(mounted.container), /No recent cached blocks available yet/);

  // Poll error when cache is empty
  blockchain.chainName = 'testnet';
  baseStore.recents = [];
  baseStore.lastPollError = 'HTTP 503';
  await nextTick();
  assert.match(text(mounted.container), /Could not load recent blocks: HTTP 503/);
});
