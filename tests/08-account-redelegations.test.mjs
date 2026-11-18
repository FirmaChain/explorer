import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { after, describe, test } from 'node:test';
import { createServer } from 'vite';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';
import { toBech32 } from '@cosmjs/encoding';
import { loadProduct, mount, root } from './helpers/validator-renderer.mjs';
import {
  button,
  click,
  findAll,
  rows,
  text,
} from './helpers/validator-renderer.mjs';

const accountAddr = toBech32('firma', new Uint8Array(20).fill(10));
const srcVal = toBech32('firma' + 'valoper', new Uint8Array(20).fill(11));
const dstValA = toBech32('firma' + 'valoper', new Uint8Array(20).fill(12));
const dstValB = toBech32('firma' + 'valoper', new Uint8Array(20).fill(13));
const opaque = '+/8=&?cursor%雪';

function entry(balance, completion_time, creation_height = '100') {
  return {
    redelegation_entry: {
      creation_height,
      completion_time,
      initial_balance: balance,
      shares_dst: balance,
    },
    balance,
  };
}

function item(src, dst, entries) {
  return {
    redelegation: {
      delegator_address: accountAddr,
      validator_src_address: src,
      validator_dst_address: dst,
    },
    entries,
  };
}

function page(responses = [], next_key = null) {
  return {
    redelegation_responses: responses,
    pagination: { next_key },
  };
}

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
        name: 'account-redelegation-boundaries',
        enforce: 'pre',
        resolveId(id) {
          if (id === '@/libs' || id === `${root}src/libs`)
            return '\0account-libs';
          if (id === '@/stores' || id === `${root}src/stores`)
            return '\0account-stores';
        },
        load(id) {
          if (id === '\0account-libs') {
            return 'export * from "/src/libs/http.ts"; export * from "/src/libs/api/index.ts";';
          }
          if (id === '\0account-stores') {
            return 'export function useBlockchain() { throw new Error("outside fixture"); }';
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

const product = await runtime();
after(async () => {
  await product.vite.close();
});

async function fixture(t, detail = false) {
  const requests = [];
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
    for (const r of requests) r.response.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await Promise.allSettled(pending);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  function rpc(suffix = '') {
    const client = product.client.CosmosRestClient.newDefault(
      endpoint + suffix
    );
    client.getAuthAccount = async () => ({ account: {} });
    client.getTxsBySender = async () => ({ tx_responses: [] });
    client.getTxs = async () => ({ tx_responses: [] });
    client.getDistributionDelegatorRewards = async () => ({
      rewards: [],
      total: [],
    });
    client.getStakingDelegations = async () => ({
      delegation_responses: [
        {
          delegation: {
            delegator_address: accountAddr,
            validator_address: srcVal,
            shares: '1000000',
          },
          balance: { denom: 'ufct', amount: '1000000' },
        },
      ],
    });
    client.getBankBalances = async () => ({ balances: [] });
    client.getStakingDelegatorUnbonding = async () => ({
      unbonding_responses: [],
    });
    const getRedelegations =
      client.getStakingDelegatorRedelegations.bind(client);
    client.getStakingDelegatorRedelegations = (...args) => {
      const result = getRedelegations(...args);
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
    current: { assets },
  });
  const actions = [];
  const staking = {
    params: { bond_denom: 'ufct' },
    validators: [],
  };
  const stores = {
    useBlockchain: () => blockchain,
    useStakingStore: () => staking,
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
    useTxDialog: () => ({ open: (...args) => actions.push(args) }),
  };
  setActivePinia(createPinia());
  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': {},
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const dependencies = { '@/stores': stores, '@/types': product.types };
  const component = await loadProduct(
    'src/components/AccountRedelegations.vue',
    dependencies
  );

  let target = component.default;
  if (detail) {
    target = (
      await loadProduct('src/modules/[chain]/account/[address].vue', {
        ...dependencies,
        '@vue/reactivity': await import('vue'),
        '@/components/dynamic/DynamicComponent.vue': { default: () => null },
        '@/components/charts/DonutChart.vue': { default: () => null },
        '@/components/Countdown.vue': { default: () => null },
        '@/components/AccountRedelegations.vue': component,
        '@iconify/vue': { Icon: () => null },
        '@cosmjs/encoding': await import('@cosmjs/encoding'),
        '@vueuse/integrations/useQRCode': {
          useQRCode: () => reactive({ value: '' }),
        },
        '@/libs/ofac': { isOfacSanctionedEvm: async () => false },
      })
    ).default;
  }

  const props = reactive({ chain: 'firmachain', address: accountAddr });
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
    requests,
    take,
    reply,
    rpc,
    formatter: stores.useFormatter(),
  };
}

test('renders per-entry source/destination validator links, balances, completion times, and opaque pagination', async (t) => {
  const f = await fixture(t);
  const req = await f.take();
  assert.equal(
    req.url.pathname,
    `/cosmos/staking/v1beta1/delegators/${accountAddr}/redelegations`
  );
  assert.deepEqual([...req.url.searchParams], [['pagination.limit', '10']]);

  const t1 = '2026-12-01T00:00:00Z';
  const t2 = '2026-12-07T06:00:00Z';
  await f.reply(
    req,
    page(
      [
        item(srcVal, dstValA, [
          entry('12000000', t1, '100'),
          entry('34000000', t2, '101'),
        ]),
      ],
      opaque
    )
  );

  assert.deepEqual(rows(f.container), [
    `${srcVal}${dstValA}12 FCT${f.formatter.toDay(t1, 'short')}`,
    `${srcVal}${dstValA}34 FCT${f.formatter.toDay(t2, 'short')}`,
  ]);
  assert.deepEqual(
    findAll(f.container, (el) => el.type === 'a').map((el) => el.props.href),
    [
      `/firmachain/staking/${srcVal}`,
      `/firmachain/staking/${dstValA}`,
      `/firmachain/staking/${srcVal}`,
      `/firmachain/staking/${dstValA}`,
    ]
  );

  const page2 = await f.take(() => click(button(f.container, 'Next')));
  assert.equal(page2.url.searchParams.get('pagination.key'), opaque);
  await f.reply(page2, {}, 503);
  assert.match(
    text(f.container),
    /Could not load active redelegations page 2.*503/
  );

  const retry = await f.take(() => click(button(f.container, 'Retry')));
  assert.equal(retry.url.searchParams.get('pagination.key'), opaque);
  const t3 = '2026-12-10T00:00:00Z';
  await f.reply(retry, page([item(srcVal, dstValB, [entry('50000000', t3)])]));
  assert.deepEqual(rows(f.container), [
    `${srcVal}${dstValB}50 FCT${f.formatter.toDay(t3, 'short')}`,
  ]);
});

test('handles empty state, repeated cursor, and stale address/chain switches', async (t) => {
  const f = await fixture(t);
  await f.reply(await f.take(), page());
  assert.match(text(f.container), /No active redelegations found/);

  // Address switch invalidates in-flight response
  const nextAddr = toBech32('firma', new Uint8Array(20).fill(99));
  const old = await f.take(() => {
    f.props.address = nextAddr;
  });
  const current = await f.take(() => {
    f.props.chain = 'testnet';
    f.blockchain.chainName = 'testnet';
  });
  const tReady = '2026-12-15T00:00:00Z';
  await f.reply(
    current,
    page([item(srcVal, dstValA, [entry('9000000', tReady)])])
  );
  await f.reply(
    old,
    page([item(srcVal, dstValB, [entry('1000000', '2026-12-01T00:00:00Z')])])
  );
  assert.deepEqual(rows(f.container), [
    `${srcVal}${dstValA}9 FCT${f.formatter.toDay(tReady, 'short')}`,
  ]);
});

test('account detail route preserves Redelegate action button alongside Active Redelegations', async (t) => {
  const f = await fixture(t, true);
  const req = await f.take();
  const t1 = '2026-12-20T00:00:00Z';
  await f.reply(req, page([item(srcVal, dstValA, [entry('22000000', t1)])]));

  assert.match(text(f.container), /Active Redelegations/);
  assert.match(text(f.container), /22 FCT/);
  const redelegateBtn = findAll(
    f.container,
    (el) => el.props.for === 'redelegate'
  )[0];
  assert.ok(redelegateBtn);
  click(redelegateBtn);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0][0], 'redelegate');
  assert.deepEqual(f.actions[0][1], { validator_address: srcVal });
});
