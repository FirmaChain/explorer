import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { after, describe, test } from 'node:test';
import { createServer } from 'vite';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';
import Long from 'long';
import { fromHex, toBase64, toBech32 } from '@cosmjs/encoding';
import {
  QueryRedelegationsRequest,
  QueryRedelegationsResponse,
} from 'cosmjs-types/cosmos/staking/v1beta1/query';
import { loadProduct, mount, root } from './helpers/validator-renderer.mjs';
import {
  button,
  click,
  findAll,
  rows,
  text,
} from './helpers/validator-renderer.mjs';

const srcValidator = toBech32('firma' + 'valoper', new Uint8Array(20).fill(3));
const dstValidatorA = toBech32('firma' + 'valoper', new Uint8Array(20).fill(4));
const dstValidatorB = toBech32('firma' + 'valoper', new Uint8Array(20).fill(5));
const cursorBytes = new Uint8Array([0x2b, 0x2f, 0x38, 0x3d, 0x26, 0x99]);
const cursorB64 = toBase64(cursorBytes);

function toProtoTimestamp(iso) {
  const ms = Date.parse(iso);
  return {
    seconds: Long.fromNumber(Math.floor(ms / 1000), false),
    nanos: (ms % 1000) * 1_000_000,
  };
}

function makeResponse(items = [], nextKey = new Uint8Array()) {
  const bytes = QueryRedelegationsResponse.encode(
    QueryRedelegationsResponse.fromPartial({
      redelegationResponses: items,
      pagination: { nextKey },
    })
  ).finish();
  return {
    jsonrpc: '2.0',
    id: -1,
    result: {
      response: {
        code: 0,
        log: '',
        info: '',
        value: toBase64(bytes),
        height: '12345',
      },
    },
  };
}

function makeItem(delegator, dst, entries) {
  return {
    redelegation: {
      delegatorAddress: delegator,
      validatorSrcAddress: srcValidator,
      validatorDstAddress: dst,
    },
    entries: entries.map(([balance, iso, height = 100]) => ({
      redelegationEntry: {
        creationHeight: Long.fromNumber(height, false),
        completionTime: toProtoTimestamp(iso),
        initialBalance: balance,
        sharesDst: balance,
      },
      balance,
    })),
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
        name: 'validator-redelegation-boundaries',
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
            return 'export function useBlockchain() { throw new Error("Custom-chain store is outside fixture"); }';
          }
        },
      },
    ],
  });
  try {
    const client = await vite.ssrLoadModule('/src/libs/client.ts');
    const types = await vite.ssrLoadModule('/src/types/common.ts');
    const abci = await vite.ssrLoadModule('/src/libs/abci.ts');
    return { vite, client, types, abci };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

const product = await runtime();
after(async () => {
  await product.vite.close();
});

async function fixture(t, { withRpc = true, detail = false } = {}) {
  const requests = [];
  const arrivals = new EventEmitter();
  const server = createHttpServer((request, response) => {
    requests.push({
      url: new URL(request.url, `http://${request.headers.host}`),
      response,
    });
    arrivals.emit('request');
  });
  let mounted;
  t.after(async () => {
    mounted?.app.unmount();
    for (const item of requests) item.response.destroy();
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;

  const assets = [
    {
      base: 'ufct',
      denom_units: [
        { denom: 'ufct', exponent: 0 },
        { denom: 'fct', exponent: 6 },
      ],
    },
  ];

  const rpcStub = markRaw({
    endpoint,
    getTxsBySender: async () => ({ tx_responses: [] }),
    getTxs: async () => ({ tx_responses: [], pagination: { total: '0' } }),
    getDistributionValidatorCommission: async () => ({
      commission: { commission: [{ denom: 'ufct', amount: '7000000' }] },
    }),
    getDistributionValidatorOutstandingRewards: async () => ({
      rewards: { rewards: [{ denom: 'ufct', amount: '11000000' }] },
    }),
    getStakingValidatorsDelegations: async () => ({
      delegation_responses: [],
      pagination: { next_key: null },
    }),
    getStakingValidatorsUnbondings: async () => ({
      unbonding_responses: [],
      pagination: { next_key: null },
    }),
  });

  const blockchain = reactive({
    chainName: 'firmachain',
    endpoint: { address: endpoint },
    rpc: rpcStub,
    current: {
      assets,
      bech32ConsensusPrefix: 'firmavalcons',
      endpoints: {
        rpc: withRpc ? [{ address: `${endpoint}/rpc-a`, provider: 'test' }] : [],
      },
    },
  });

  const actions = [];
  const info = {
    operator_address: srcValidator,
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
          validator_address: srcValidator,
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

  const dependencies = {
    '@/stores': stores,
    '@/types': product.types,
    '@/libs/abci': product.abci,
  };
  const component = await loadProduct(
    'src/components/ValidatorRedelegations.vue',
    dependencies
  );

  let target = component.default;
  if (detail) {
    const addresses = await loadProduct('src/libs/address.ts');
    const utils = await loadProduct('src/libs/utils.ts');
    target = (
      await loadProduct('src/modules/[chain]/staking/[validator].vue', {
        ...dependencies,
        '@/libs': addresses,
        '@/libs/utils': utils,
        '@/components/ValidatorDelegations.vue': await loadProduct(
          'src/components/ValidatorDelegations.vue',
          dependencies
        ),
        '@/components/ValidatorUnbondings.vue': await loadProduct(
          'src/components/ValidatorUnbondings.vue',
          dependencies
        ),
        '@/components/ValidatorRedelegations.vue': component,
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

  const props = reactive({ chain: 'firmachain', validator: srcValidator });
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
    request.response.writeHead(status, { 'content-type': 'application/json' });
    request.response.end(JSON.stringify(body));
    await new Promise((resolve) => setTimeout(resolve, 15));
    await nextTick();
  }

  return {
    ...mounted,
    props,
    blockchain,
    actions,
    requests,
    endpoint,
    take,
    reply,
    formatter: stores.useFormatter(),
  };
}

function decodeAbciData(request) {
  const hex = request.url.searchParams.get('data') || '';
  assert.match(hex, /^0x[0-9a-fA-F]*$/);
  return QueryRedelegationsRequest.decode(fromHex(hex.slice(2)));
}

test(
  'encodes srcValidatorAddr protobuf query, decodes multiple entries, links delegator & destination, and formats balances/times',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const req = await f.take();
    assert.equal(req.url.pathname, '/rpc-a/abci_query');
    assert.equal(
      req.url.searchParams.get('path'),
      '"/cosmos.staking.v1beta1.Query/Redelegations"'
    );
    const decodedReq = decodeAbciData(req);
    assert.equal(decodedReq.srcValidatorAddr, srcValidator);
    assert.equal(decodedReq.delegatorAddr, '');
    assert.equal(decodedReq.dstValidatorAddr, '');
    assert.equal(Number(decodedReq.pagination.limit), 10);
    assert.equal(decodedReq.pagination.countTotal, false);

    const t1 = '2026-12-01T00:00:00.000Z';
    const t2 = '2026-12-06T08:00:00.000Z';
    const t3 = '2026-12-11T14:00:00.000Z';
    await f.reply(
      req,
      makeResponse(
        [
          makeItem('firma1alice', dstValidatorA, [
            ['123000000', t1, 101],
            ['45000000', t2, 102],
          ]),
          makeItem('firma1bob', dstValidatorB, [['80000000', t3, 103]]),
        ],
        cursorBytes
      )
    );

    assert.deepEqual(rows(f.container), [
      `firma1alice${dstValidatorA}123 FCT${f.formatter.toDay(t1, 'short')}`,
      `firma1alice${dstValidatorA}45 FCT${f.formatter.toDay(t2, 'short')}`,
      `firma1bob${dstValidatorB}80 FCT${f.formatter.toDay(t3, 'short')}`,
    ]);
    assert.deepEqual(
      findAll(f.container, (el) => el.type === 'a').map((el) => el.props.href),
      [
        '/firmachain/account/firma1alice',
        `/firmachain/staking/${dstValidatorA}`,
        '/firmachain/account/firma1alice',
        `/firmachain/staking/${dstValidatorA}`,
        '/firmachain/account/firma1bob',
        `/firmachain/staking/${dstValidatorB}`,
      ]
    );
    assert.equal(button(f.container, 'Previous').props.disabled, true);
    assert.equal(button(f.container, 'Next').props.disabled, false);
  }
);

test(
  'missing RPC endpoint surfaces explicit error without sending requests',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, { withRpc: false });
    await nextTick();
    await nextTick();
    assert.equal(f.requests.length, 0);
    assert.match(text(f.container), /No RPC endpoint is configured/);
    assert.equal(
      findAll(f.container, (el) => el.props.role === 'alert').length,
      1
    );
  }
);

test(
  'ABCI non-zero error code is treated as failure rather than empty success',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const req = await f.take();
    await f.reply(req, {
      jsonrpc: '2.0',
      id: -1,
      result: {
        response: {
          code: 18,
          log: 'unknown query path',
        },
      },
    });
    assert.match(text(f.container), /unknown query path/);
    assert.doesNotMatch(
      text(f.container),
      /No active outgoing redelegations found/
    );
    assert.equal(
      findAll(f.container, (el) => el.props.role === 'alert').length,
      1
    );

    const retry = await f.take(() => click(button(f.container, 'Retry')));
    await f.reply(retry, makeResponse([]));
    assert.match(text(f.container), /No active outgoing redelegations found/);
    assert.equal(
      findAll(f.container, (el) => el.props.role === 'alert').length,
      0
    );
  }
);

test(
  'multi-page pagination passes raw binary cursor key, handles page 2 failure/retry and repeated cursor',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const t1 = '2026-12-01T00:00:00.000Z';
    const t2 = '2026-12-09T00:00:00.000Z';
    await f.reply(
      await f.take(),
      makeResponse(
        [makeItem('firma1first', dstValidatorA, [['10000000', t1]])],
        cursorBytes
      )
    );

    const second = await f.take(() => click(button(f.container, 'Next')));
    assert.deepEqual(rows(f.container), [
      `firma1first${dstValidatorA}10 FCT${f.formatter.toDay(t1, 'short')}`,
    ]);
    const decodedSecond = decodeAbciData(second);
    assert.equal(toBase64(decodedSecond.pagination.key), cursorB64);

    await f.reply(second, {}, 502);
    assert.match(
      text(f.container),
      /Could not load outgoing redelegations page 2.*502/
    );

    const retry = await f.take(() => click(button(f.container, 'Retry')));
    assert.equal(toBase64(decodeAbciData(retry).pagination.key), cursorB64);
    await f.reply(
      retry,
      makeResponse(
        [makeItem('firma1second', dstValidatorB, [['20000000', t2]])],
        cursorBytes
      )
    );
    // Repeated cursor on page 2 triggers loop protection error
    assert.match(text(f.container), /repeated page cursor/);
    assert.equal(button(f.container, 'Next').props.disabled, true);

    await f.reply(
      await f.take(() => click(button(f.container, 'Previous'))),
      makeResponse(
        [makeItem('firma1first', dstValidatorA, [['10000000', t1]])],
        cursorBytes
      )
    );
    const cleanSecond = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(
      cleanSecond,
      makeResponse([makeItem('firma1second', dstValidatorB, [['20000000', t2]])])
    );
    assert.deepEqual(rows(f.container), [
      `firma1second${dstValidatorB}20 FCT${f.formatter.toDay(t2, 'short')}`,
    ]);
  }
);

describe('outgoing redelegation request lifecycle', () => {
  test(
    'late response after validator switch cannot overwrite new validator data',
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t);
      const old = await f.take();
      const nextVal = toBech32('firma' + 'valoper', new Uint8Array(20).fill(9));
      const current = await f.take(() => {
        f.props.validator = nextVal;
      });
      assert.equal(decodeAbciData(current).srcValidatorAddr, nextVal);
      const tNew = '2026-12-20T00:00:00.000Z';
      await f.reply(
        current,
        makeResponse([makeItem('firma1current', dstValidatorA, [['30000000', tNew]])])
      );
      await f.reply(
        old,
        makeResponse([makeItem('firma1stale', dstValidatorB, [['10000000', tNew]])])
      );
      assert.deepEqual(rows(f.container), [
        `firma1current${dstValidatorA}30 FCT${f.formatter.toDay(tNew, 'short')}`,
      ]);
    }
  );

  test(
    'chain switch and RPC endpoint switch invalidate stale responses',
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t);
      const old = await f.take();
      const switched = await f.take(() => {
        f.blockchain.current.endpoints.rpc = [
          { address: `${f.endpoint}/rpc-b`, provider: 'b' },
        ];
      });
      assert.equal(switched.url.pathname, '/rpc-b/abci_query');
      await f.reply(old, {}, 500);
      assert.match(text(f.container), /Loading outgoing redelegations/);
      const tNew = '2026-12-21T00:00:00.000Z';
      await f.reply(
        switched,
        makeResponse([makeItem('firma1rpcb', dstValidatorA, [['60000000', tNew]])])
      );
      assert.deepEqual(rows(f.container), [
        `firma1rpcb${dstValidatorA}60 FCT${f.formatter.toDay(tNew, 'short')}`,
      ]);
    }
  );
});

for (const state of ['success', 'empty', 'error']) {
  test(
    `detail route integrates outgoing redelegations during ${state}`,
    { timeout: 10000 },
    async (t) => {
      const original = globalThis.localStorage;
      globalThis.localStorage = { getItem: () => null };
      t.after(() => {
        if (original === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = original;
      });
      const f = await fixture(t, { detail: true });
      const req = await f.take();
      const tDetail = '2026-12-28T00:00:00.000Z';
      await f.reply(
        req,
        state === 'success'
          ? makeResponse([
              makeItem('firma1detail', dstValidatorA, [['77000000', tDetail]]),
            ])
          : makeResponse([]),
        state === 'error' ? 503 : 200
      );
      assert.match(text(f.container), /7 FCT/);
      assert.match(text(f.container), /11 FCT/);
      if (state === 'success') {
        assert.match(text(f.container), /firma1detail/);
        assert.match(text(f.container), /77 FCT/);
      } else if (state === 'empty') {
        assert.match(
          text(f.container),
          /No active outgoing redelegations found/
        );
      } else {
        assert.match(
          text(f.container),
          /Could not load outgoing redelegations page 1.*503/
        );
      }
    }
  );
}
