import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { after } from 'node:test';
import { createServer } from 'vite';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';
import { toBech32 } from '@cosmjs/encoding';
import { loadProduct, mount, root } from './validator-renderer.mjs';

export const validator = toBech32(
  'firma' + 'valoper',
  new Uint8Array(20).fill(2)
);
export const opaque = '+/8=&?cursor%雪';

export const entry = (
  balance = '123000000',
  completion_time = '2026-12-01T00:00:00Z',
  creation_height = '100',
  unbonding_id
) => ({
  creation_height,
  completion_time,
  initial_balance: balance,
  balance,
  ...(unbonding_id !== undefined ? { unbonding_id } : {}),
});

export const unbonding = (delegator_address, entries = [entry()]) => ({
  delegator_address,
  validator_address: validator,
  entries,
});

export const page = (responses = [], next_key = null) => ({
  unbonding_responses: responses,
  pagination: { next_key },
});

async function runtime() {
  const vite = await createServer({
    root,
    configFile: false,
    server: {
      middlewareMode: true,
      watch: null,
      hmr: { server: createHttpServer() },
    },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { '@': `${root}src` } },
    plugins: [
      {
        name: 'validator-unbonding-node-boundaries',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@/libs' || id === `${root}src/libs`)
            return '\0validator-libs';
          if (id === '@/stores' || id === `${root}src/stores`)
            return '\0validator-stores';
        },
        load(id) {
          if (id === '\0validator-libs') {
            return 'export * from "/src/libs/http.ts"; export * from "/src/libs/api/index.ts";';
          }
          if (id === '\0validator-stores') {
            return 'export function useBlockchain() { throw new Error("Custom-chain store is outside this default REST fixture"); }';
          }
        },
      },
    ],
  });
  try {
    const client = await vite.ssrLoadModule('/src/libs/client.ts');
    const types = await vite.ssrLoadModule('/src/types/common.ts');
    return { vite, client, types };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

export const product = await runtime();
after(async () => {
  await product.vite.close();
});

export async function fixture(t, runtime, detail = false) {
  const requests = [];
  const txCalls = [];
  const arrivals = new EventEmitter();
  const server = createHttpServer((request, response) => {
    requests.push({
      url: new URL(request.url, `http://${request.headers.host}`),
      response,
    });
    arrivals.emit('request');
  });
  const pending = [];
  let mounted;
  t.after(async () => {
    mounted?.app.unmount();
    for (const item of requests) item.response.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await Promise.allSettled(pending);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const endpoint = `http://127.0.0.1:${address.port}`;

  function rpc(suffix = '') {
    const client = runtime.client.CosmosRestClient.newDefault(
      endpoint + suffix
    );
    client.getTxsBySender = async () => ({ tx_responses: [] });
    client.getTxs = async (...args) => {
      txCalls.push(args);
      return {
        tx_responses: [],
        pagination: { total: '0' },
      };
    };
    client.getDistributionValidatorCommission = async () => ({
      commission: { commission: [{ denom: 'ufct', amount: '7000000' }] },
    });
    client.getDistributionValidatorOutstandingRewards = async () => ({
      rewards: { rewards: [{ denom: 'ufct', amount: '11000000' }] },
    });
    client.getStakingValidatorsDelegations = async () => ({
      delegation_responses: [],
      pagination: { next_key: null },
    });
    const getUnbondings = client.getStakingValidatorsUnbondings.bind(client);
    client.getStakingValidatorsUnbondings = (...args) => {
      const result = getUnbondings(...args);
      pending.push(result);
      return result;
    };
    return markRaw(client);
  }

  const assets = [
    {
      base: 'ufct',
      denom_units: [
        { denom: 'ufct', exponent: 0 },
        { denom: 'fct', exponent: 6 },
      ],
    },
  ];
  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: endpoint },
    rpc: rpc(),
    current: { assets, bech32ConsensusPrefix: 'firmavalcons' },
  });
  const actions = [];
  const info = {
    operator_address: validator,
    description: { moniker: 'Fixture validator' },
    tokens: '1000000000',
    commission: {
      commission_rates: {
        rate: '0.1',
        max_rate: '0.2',
        max_change_rate: '0.01',
      },
    },
    consensus_pubkey: {
      '@type': '/cosmos.crypto.ed25519.PubKey',
      key: Buffer.alloc(32, 1).toString('base64'),
    },
  };
  const staking = {
    params: { bond_denom: 'ufct' },
    pool: { bonded_tokens: '500000000' },
    fetchValidator: async () => ({ validator: info }),
    fetchValidatorDelegation: async () => ({
      delegation_response: {
        delegation: {
          delegator_address: 'self',
          validator_address: validator,
          shares: '5000000',
        },
        balance: { denom: 'ufct', amount: '5000000' },
      },
    }),
  };
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => staking,
    useBankStore: () => ({ supply: { amount: '1000000000' } }),
    useMintStore: () => ({ inflation: '0.1' }),
    useDistributionStore: () => ({ params: { community_tax: '0.02' } }),
    useDashboard: () => ({ chains: {} }),
    useTxDialog: () => ({ open: (...args) => actions.push(args) }),
    useBaseStore: () => ({ recents: [], currentChainId: '' }),
  };
  setActivePinia(createPinia());
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': {},
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;
  const dependencies = { '@/stores': stores, '@/types': runtime.types };
  const component = await loadProduct(
    'src/components/ValidatorUnbondings.vue',
    dependencies
  );
  let target = component.default;
  if (detail) {
    const addresses = await loadProduct('src/libs/address.ts');
    const utils = await loadProduct('src/libs/utils.ts');
    const abci = await loadProduct('src/libs/abci.ts', {
      'cross-fetch': fetch,
      '@/types': runtime.types,
    });
    target = (
      await loadProduct('src/modules/[chain]/staking/[validator].vue', {
        ...dependencies,
        '@/libs': addresses,
        '@/libs/utils': utils,
        '@/components/ValidatorDelegations.vue': await loadProduct(
          'src/components/ValidatorDelegations.vue',
          dependencies
        ),
        '@/components/ValidatorUnbondings.vue': component,
        '@/components/ValidatorRedelegations.vue': await loadProduct(
          'src/components/ValidatorRedelegations.vue',
          { ...dependencies, '@/libs/abci': abci }
        ),
        '@/components/ValidatorProposedBlocks.vue': await loadProduct(
          'src/components/ValidatorProposedBlocks.vue',
          { ...dependencies, '@/libs': addresses }
        ),
        '@/components/PaginationBar.vue': await loadProduct(
          'src/components/PaginationBar.vue'
        ),
        '@/components/ValidatorCommissionRate.vue': await loadProduct(
          'src/components/ValidatorCommissionRate.vue',
          {
            ...dependencies,
            'vue3-apexcharts': { default: () => null, __esModule: true },
          }
        ),
        '@iconify/vue': { Icon: () => null },
      })
    ).default;
  }
  const props = reactive({ chain: 'firmachain', validator });
  mounted = mount(target, props);

  async function take(action = () => {}) {
    const index = requests.length;
    const arrived = once(arrivals, 'request', {
      signal: AbortSignal.timeout(5000),
    });
    action();
    await arrived;
    return requests[index];
  }

  async function reply(request, body, status = 200) {
    const operation = pending[requests.indexOf(request)];
    request.response.writeHead(status, { 'content-type': 'application/json' });
    request.response.end(JSON.stringify(body));
    await Promise.allSettled([operation]);
    await nextTick();
  }

  return {
    ...mounted,
    props,
    blockchain,
    actions,
    txCalls,
    requests,
    take,
    reply,
    rpc,
    pending,
    formatter: stores.useFormatter(),
  };
}
