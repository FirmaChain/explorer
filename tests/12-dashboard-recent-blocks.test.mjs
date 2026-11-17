import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { findAll, rows, text } from './helpers/validator-renderer.mjs';

function block(h, chain_id = 'firmachain-1') {
  return {
    block_id: { hash: `H-${h}` },
    block: {
      header: {
        chain_id,
        height: String(h),
        time: `2026-11-17T00:00:${String(h % 60).padStart(2, '0')}Z`,
        proposer_address: '',
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
      block(10),
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

  const comp = (
    await loadProduct('src/components/DashboardRecentBlocks.vue', {
      '@/stores': stores,
      '@/libs/dashboardMetrics': metrics,
    })
  ).default;

  const props = reactive({ chain: 'firmachain' });
  const mounted = mount(comp, props);
  t.after(() => mounted.app.unmount());

  assert.equal(rows(mounted.container).length, 7);
  assert.match(rows(mounted.container)[0], /^10-/);
  assert.match(rows(mounted.container)[6], /^2-/);
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
