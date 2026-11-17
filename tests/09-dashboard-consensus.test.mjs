import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { button, click, findAll, text } from './helpers/validator-renderer.mjs';

const pub = Buffer.alloc(32, 3);
const proposerHex = toHex(sha256(pub).slice(0, 20)).toUpperCase();

async function createConsensusFixture(t, handler) {
  const requests = [];
  const arrivals = new EventEmitter();
  const server = createHttpServer((req, res) => {
    requests.push({ url: req.url, res });
    arrivals.emit('request');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const r of requests) r.res.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

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
  const abci = await loadProduct('src/libs/abci.ts', {
    'cross-fetch': fetch,
    '@/types': types,
  });
  const metrics = await loadProduct('src/libs/dashboardMetrics.ts', {
    'cross-fetch': fetch,
    '@/libs/address': addresses,
    '@/libs/blockSignatures': blockSigs,
    '@/libs/stakingConcentration': concentration,
    '@/types': types,
  });

  const blockchain = reactive({
    chainName: 'firmachain',
    current: {
      endpoints: { rpc: [{ address: `${endpoint}/rpc-a` }] },
    },
  });
  const stores = {
    useBlockchain: () => blockchain,
    useBaseStore: () => ({ blocktime: 60000 }),
    useStakingStore: () => ({
      validators: [
        {
          description: { moniker: 'Proposer-Val' },
          consensus_pubkey: { '@type': '/cosmos.crypto.ed25519.PubKey', key: toBase64(pub) },
        },
      ],
    }),
  };

  const component = (
    await loadProduct('src/components/DashboardConsensus.vue', {
      '@/stores': stores,
      '@/libs': addresses,
      '@/libs/abci': abci,
      '@/libs/dashboardMetrics': metrics,
    })
  ).default;

  const props = reactive({ chain: 'firmachain' });
  const mounted = mount(component, props);
  t.after(() => mounted.app.unmount());

  if (handler) {
    // automatic reply helper
    arrivals.on('request', () => {
      const item = requests[requests.length - 1];
      handler(item);
    });
  }

  return { ...mounted, props, blockchain, endpoint, requests, arrivals };
}

test('polls consensus_state, renders height/round/step/proposer, recovers from failure, and discards stale chain state', async (t) => {
  let failFirst = true;
  const f = await createConsensusFixture(t, (item) => {
    if (item.url.startsWith('/rpc-a/') && failFirst) {
      failFirst = false;
      item.res.writeHead(503, { 'content-type': 'application/json' });
      item.res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    const height = item.url.startsWith('/rpc-b/') ? '200' : '150';
    item.res.writeHead(200, { 'content-type': 'application/json' });
    item.res.end(
      JSON.stringify({
        result: {
          round_state: {
            'height/round/step': `${height}/1/3`,
            proposer: { address: proposerHex },
          },
        },
      })
    );
  });

  await new Promise((r) => setTimeout(r, 40));
  await nextTick();
  assert.match(text(f.container), /Consensus state unavailable/);

  click(button(f.container, 'Retry'));
  await new Promise((r) => setTimeout(r, 40));
  await nextTick();
  assert.match(text(f.container), /Height150Round1Step3ProposerProposer-Val/);
  assert.match(text(f.container), /events between polls are not captured/);

  // Switch RPC endpoint -> clears old state and loads new endpoint height 200
  f.blockchain.current.endpoints.rpc = [{ address: `${f.endpoint}/rpc-b` }];
  await new Promise((r) => setTimeout(r, 40));
  await nextTick();
  assert.match(text(f.container), /Height200Round1Step3/);
  assert.equal(findAll(f.container, (el) => el.props.role === 'alert').length, 0);
});
