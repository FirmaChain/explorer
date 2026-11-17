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

async function createConsensusFixture(t, handler, options = {}) {
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
  const baseStore = reactive({ blocktime: options.blocktime ?? 6000 });
  const stores = {
    useBlockchain: () => blockchain,
    useBaseStore: () => baseStore,
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

  return { ...mounted, props, blockchain, baseStore, endpoint, requests, arrivals };
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

function installFastPollTimerMock(t) {
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const scheduledDelays = [];
  globalThis.setTimeout = (fn, delay = 0, ...args) => {
    const isConsensusTimer =
      delay >= 2000 && new Error().stack?.includes('scheduleNext');
    if (isConsensusTimer) {
      scheduledDelays.push(delay);
      return origSetTimeout(fn, 20, ...args);
    }
    return origSetTimeout(fn, delay, ...args);
  };
  globalThis.clearTimeout = (id) => origClearTimeout(id);
  t.after(() => {
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
  });
  return scheduledDelays;
}

function installDocumentVisibilityMock(t, initialHidden = false) {
  const listeners = new Map();
  const prevDocument = globalThis.document;
  const mockDocument = {
    hidden: initialHidden,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type) {
      for (const fn of listeners.get(type) || []) {
        fn();
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
  globalThis.document = mockDocument;
  t.after(() => {
    if (prevDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDocument;
    }
  });
  return mockDocument;
}

async function nextRequest(f, index) {
  while (f.requests.length <= index) {
    await once(f.arrivals, 'request', { signal: AbortSignal.timeout(2000) });
  }
  return f.requests[index];
}

function sendRoundState(item, height) {
  item.res.writeHead(200, { 'content-type': 'application/json' });
  item.res.end(
    JSON.stringify({
      result: {
        round_state: {
          'height/round/step': `${height}/0/1`,
          proposer: { address: proposerHex },
        },
      },
    })
  );
}

test('continues periodic polling automatically with error backoff and adaptive blocktime interval', async (t) => {
  const scheduledDelays = installFastPollTimerMock(t);
  const f = await createConsensusFixture(t, null, { blocktime: 6000 });

  // 1st poll -> Height 101 (schedules 3000ms)
  sendRoundState(await nextRequest(f, 0), '101');
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  assert.match(text(f.container), /Height101Round0Step1/);
  assert.equal(scheduledDelays[0], 3000);

  // 2nd poll -> 503 error (schedules 6000ms backoff)
  const req2 = await nextRequest(f, 1);
  req2.res.writeHead(503, { 'content-type': 'application/json' });
  req2.res.end(JSON.stringify({ error: 'temporary failure' }));
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  assert.match(text(f.container), /Consensus state unavailable/);
  assert.equal(scheduledDelays[1], 6000);

  // 3rd poll -> recovers automatically to Height 103 (resets to 3000ms)
  sendRoundState(await nextRequest(f, 2), '103');
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  assert.match(text(f.container), /Height103Round0Step1/);
  assert.equal(scheduledDelays[2], 3000);
});

test('pauses polling when document is hidden, resumes immediately when visible, and cleans up listener on unmount', async (t) => {
  installFastPollTimerMock(t);
  const doc = installDocumentVisibilityMock(t, false);
  let seq = 0;

  const f = await createConsensusFixture(t, (item) => {
    seq += 1;
    item.res.writeHead(200, { 'content-type': 'application/json' });
    item.res.end(
      JSON.stringify({
        result: {
          round_state: {
            'height/round/step': `${300 + seq}/0/2`,
            proposer: { address: proposerHex },
          },
        },
      })
    );
  });

  await new Promise((r) => setTimeout(r, 15));
  await nextTick();
  assert.equal(doc.listenerCount('visibilitychange'), 1);
  assert.match(text(f.container), /Height301Round0Step2/);

  // Hide tab -> stops polling
  doc.hidden = true;
  doc.emit('visibilitychange');
  const countWhenHidden = f.requests.length;

  await new Promise((r) => setTimeout(r, 70));
  assert.equal(f.requests.length, countWhenHidden);

  // Show tab -> immediately polls and resumes periodic schedule
  doc.hidden = false;
  doc.emit('visibilitychange');
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();
  assert.ok(f.requests.length > countWhenHidden);
  assert.match(text(f.container), /Height302Round0Step2/);

  // Unmount removes visibilitychange listener
  f.app.unmount();
  assert.equal(doc.listenerCount('visibilitychange'), 0);
});
