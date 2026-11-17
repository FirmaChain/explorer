import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, rows, text } from './helpers/validator-renderer.mjs';

test('renders paginated deposits with multi-denom amounts, opaque cursors, retry, and distinguishes closed empty vs active empty', async (t) => {
  const addresses = await loadProduct('src/libs/address.ts');
  const types = await loadProduct('src/types/common.ts');
  const concentration = await loadProduct('src/libs/stakingConcentration.ts', {
    '@/libs/address': addresses,
    '@/types': types,
  });
  const abci = await loadProduct('src/libs/abci.ts', {
    'cross-fetch': fetch,
    '@/types': types,
  });
  const govHelpers = await loadProduct('src/libs/govHelpers.ts', {
    '@/libs/abci': abci,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  let failPage2 = true;
  const requestedPages = [];
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
    current: {
      assets: [
        { base: 'ufct', denom_units: [{ denom: 'ufct', exponent: 0 }, { denom: 'fct', exponent: 6 }] },
      ],
    },
  });

  setActivePinia(createPinia());
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => ({ validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
    useGovStore: () => ({
      fetchProposalDeposits: async (proposalId, page) => {
        requestedPages.push({ proposalId, key: page?.key || null, limit: page?.limit });
        if (proposalId === '13') return { deposits: [], pagination: {} };
        if (!page?.key) {
          return {
            deposits: [
              {
                proposal_id: proposalId,
                depositor: 'firma1dep1',
                amount: [
                  { denom: 'ufct', amount: '10000000' },
                  { denom: 'uatom', amount: '2000000' },
                ],
              },
            ],
            pagination: { next_key: 'cur+/2' },
          };
        }
        if (failPage2) throw new Error('HTTP 503');
        return {
          deposits: [
            {
              proposal_id: proposalId,
              depositor: 'firma1dep2',
              amount: [{ denom: 'ufct', amount: '5000000' }],
            },
          ],
          pagination: { next_key: null },
        };
      },
    }),
  };

  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const comp = (
    await loadProduct('src/components/ProposalDeposits.vue', {
      '@/stores': stores,
      '@/types': types,
      '@/libs/govHelpers': govHelpers,
    })
  ).default;

  const props = reactive({
    proposalId: '99',
    chain: 'firmachain',
    proposalStatus: 'PROPOSAL_STATUS_DEPOSIT_PERIOD',
  });
  const mounted = mount(comp, props);
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(rows(mounted.container).length, 1);
  assert.match(rows(mounted.container)[0], /firma1dep1.*10 FCT/);
  assert.equal(
    findAll(mounted.container, (el) => el.type === 'nav').length,
    1
  );
  assert.equal(
    findAll(mounted.container, (el) => el.type === 'a')[0].props.href,
    '/firmachain/account/firma1dep1'
  );

  // Page 2 error + retry
  click(button(mounted.container, 'Next'));
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /Could not load deposits page 2\. HTTP 503/);

  failPage2 = false;
  click(button(mounted.container, 'Retry'));
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(rows(mounted.container)[0], /firma1dep2.*5 FCT/);

  // Closed proposal empty must NOT claim zero historical deposits
  props.proposalId = '13';
  props.proposalStatus = 'PROPOSAL_STATUS_PASSED';
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(
    text(mounted.container),
    /does not indicate zero historical deposits/
  );
  assert.equal(
    findAll(mounted.container, (el) => el.type === 'nav').length,
    0
  );
});
