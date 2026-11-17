import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { nextTick, reactive } from 'vue';
import { toBech32 } from '@cosmjs/encoding';
import { loadProduct, mount, root } from './helpers/validator-renderer.mjs';
import { button, click, rows, text } from './helpers/validator-renderer.mjs';

test('collects multi-page votes without proposal_status bug, filters weighted voters accurately across options, and resets on proposal switch', async (t) => {
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

  // Verify client.getGovProposalVotes does NOT send literal proposal_status={status}
  const requestedUrls = [];
  const vite = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    optimizeDeps: { disabled: true },
    resolve: { alias: { '@': `${root}src` } },
    plugins: [
      {
        name: 'votes-client-test-boundaries',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@/libs' || id === `${root}src/libs`) return '\0test-libs';
          if (id === '@/stores' || id === `${root}src/stores`) return '\0test-stores';
        },
        load(id) {
          if (id === '\0test-libs') {
            return `
              export const fetchData = async (url, adapter) => {
                globalThis.__TEST_VOTES_URLS__.push(url);
                return adapter({ votes: [], pagination: {} });
              };
              export const get = async () => ({});
              export * from "/src/libs/api/index.ts";
            `;
          }
          if (id === '\0test-stores') {
            return 'export function useBlockchain() { return {}; }';
          }
        },
      },
    ],
  });
  globalThis.__TEST_VOTES_URLS__ = requestedUrls;
  t.after(async () => {
    delete globalThis.__TEST_VOTES_URLS__;
    await vite.close();
  });
  const clientMod = await vite.ssrLoadModule('/src/libs/client.ts');
  const restClient = clientMod.CosmosRestClient.newDefault('https://lcd.example');
  const pReq = new types.PageRequest();
  pReq.key = 'cur+/1';
  await restClient.getGovProposalVotes('77', pReq);
  assert.doesNotMatch(requestedUrls[0], /proposal_status/);
  assert.match(requestedUrls[0], /pagination\.key=cur%2B%2F1/);

  const voter1 = toBech32('firma', new Uint8Array(20).fill(1));
  const voter2 = toBech32('firma', new Uint8Array(20).fill(2));
  const voter3 = toBech32('firma', new Uint8Array(20).fill(3));

  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: 'https://node-a.example' },
  });
  const govStore = {
    fetchProposalVotes: async (id, page) => {
      if (id === '13') return { votes: [], pagination: {} };
      if (!page?.key) {
        return {
          votes: [
            { proposal_id: id, voter: voter1, option: 'VOTE_OPTION_YES', options: [] },
            {
              proposal_id: id,
              voter: voter2,
              option: 'VOTE_OPTION_UNSPECIFIED',
              options: [
                { option: 'VOTE_OPTION_YES', weight: '0.6' },
                { option: 'VOTE_OPTION_ABSTAIN', weight: '0.4' },
              ],
            },
          ],
          pagination: { next_key: 'page2' },
        };
      }
      return {
        votes: [{ proposal_id: id, voter: voter3, option: 'VOTE_OPTION_NO', options: [] }],
        pagination: {},
      };
    },
  };

  const comp = (
    await loadProduct('src/components/ProposalVotes.vue', {
      '@/stores': {
        useBlockchain: () => blockchain,
        useGovStore: () => govStore,
        useStakingStore: () => ({ validators: [] }),
      },
      '@/types': types,
      '@/libs/govHelpers': govHelpers,
      '@cosmjs/encoding': await import('@cosmjs/encoding'),
    })
  ).default;

  const props = reactive({
    proposalId: '50',
    chain: 'firmachain',
    proposalStatus: 'PROPOSAL_STATUS_VOTING_PERIOD',
  });
  const mounted = mount(comp, props);
  t.after(() => mounted.app.unmount());
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  assert.equal(rows(mounted.container).length, 3);
  assert.match(text(mounted.container), /YES \(60%\), ABSTAIN \(40%\)/);

  // Filter YES includes both voter1 and weighted voter2
  click(button(mounted.container, 'Yes'));
  await nextTick();
  assert.equal(rows(mounted.container).length, 2);

  // Filter Abstain includes weighted voter2
  click(button(mounted.container, 'Abstain'));
  await nextTick();
  assert.equal(rows(mounted.container).length, 1);
  assert.match(rows(mounted.container)[0], new RegExp(voter2));

  // Filter No includes page-2 voter3
  click(button(mounted.container, 'No'));
  await nextTick();
  assert.equal(rows(mounted.container).length, 1);
  assert.match(rows(mounted.container)[0], new RegExp(voter3));

  // Switch to closed proposal with empty votes
  props.proposalId = '13';
  props.proposalStatus = 'PROPOSAL_STATUS_PASSED';
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();
  assert.match(text(mounted.container), /No current vote records returned.*closed proposal/);
});
