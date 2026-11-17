import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { nextTick, reactive } from 'vue';
import { toBase64, toBech32 } from '@cosmjs/encoding';
import {
  QueryValidatorsResponse,
} from 'cosmjs-types/cosmos/staking/v1beta1/query.js';
import {
  QueryVotesResponse,
} from 'cosmjs-types/cosmos/gov/v1beta1/query.js';
import govTypes from 'cosmjs-types/cosmos/gov/v1beta1/gov.js';
const { VoteOption } = govTypes;
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { rows, text } from './helpers/validator-renderer.mjs';

const rawA = new Uint8Array(20).fill(1);
const rawB = new Uint8Array(20).fill(2);
const rawC = new Uint8Array(20).fill(3);

const valA = toBech32('firmavaloper', rawA);
const valB = toBech32('firmavaloper', rawB);
const valC = toBech32('firmavaloper', rawC);
const accA = toBech32('firma', rawA);
const accC = toBech32('firma', rawC);

function abciOk(bytes, height = '500') {
  return {
    jsonrpc: '2.0',
    id: -1,
    result: { response: { code: 0, value: toBase64(bytes), height } },
  };
}

test('computes active non-voters at consistent ABCI height across multi-page votes & byte-matched addresses, and marks closed proposals unavailable', async (t) => {
  let heightMismatch = false;
  const server = createHttpServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const path = u.searchParams.get('path') || '';
    res.writeHead(200, { 'content-type': 'application/json' });
    if (path.includes('Query/Validators')) {
      const bytes = QueryValidatorsResponse.encode(
        QueryValidatorsResponse.fromPartial({
          validators: [
            { operatorAddress: valA, description: { moniker: 'Val-A' }, tokens: '100' },
            { operatorAddress: valB, description: { moniker: 'Val-B' }, tokens: '200' },
            { operatorAddress: valC, description: { moniker: 'Val-C' }, tokens: '300' },
          ],
        })
      ).finish();
      res.end(JSON.stringify(abciOk(bytes, '500')));
      return;
    }
    if (path.includes('Query/Votes')) {
      const hexData = u.searchParams.get('data') || '';
      const isSecondPage = hexData.includes('7032'); // 'p2'
      if (!isSecondPage) {
        const bytes = QueryVotesResponse.encode(
          QueryVotesResponse.fromPartial({
            votes: [
              {
                proposalId: 10,
                voter: accA,
                option: VoteOption.VOTE_OPTION_ABSTAIN,
              },
            ],
            pagination: { nextKey: new Uint8Array([0x70, 0x32]) },
          })
        ).finish();
        res.end(JSON.stringify(abciOk(bytes, '500')));
      } else {
        const bytes = QueryVotesResponse.encode(
          QueryVotesResponse.fromPartial({
            votes: [
              {
                proposalId: 10,
                voter: accC,
                options: [{ option: VoteOption.VOTE_OPTION_YES, weight: '1000000000000000000' }],
              },
            ],
          })
        ).finish();
        res.end(JSON.stringify(abciOk(bytes, heightMismatch ? '501' : '500')));
      }
      return;
    }
    res.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

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

  const blockchain = reactive({
    chainName: 'firmachain',
    current: { endpoints: { rpc: [{ address: rpcUrl }] } },
    rpc: { getBaseBlockLatest: async () => ({ block: { header: { height: '500' } } }) },
  });

  const comp = (
    await loadProduct('src/components/ProposalNonVoters.vue', {
      '@/stores': {
        useBlockchain: () => blockchain,
        useBaseStore: () => ({ latest: { block: { header: { height: '500' } } } }),
      },
      '@/libs/abci': abci,
      '@/libs/govHelpers': govHelpers,
    })
  ).default;

  const props = reactive({
    proposalId: '10',
    chain: 'firmachain',
    proposalStatus: 'PROPOSAL_STATUS_VOTING_PERIOD',
  });
  const mounted = mount(comp, props);
  t.after(() => mounted.app.unmount());
  async function waitUntilSettled(expectedPattern) {
    for (let i = 0; i < 200; i++) {
      await nextTick();
      const content = text(mounted.container);
      if (expectedPattern.test(content)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${expectedPattern}. Current: ${text(mounted.container)}`);
  }

  await waitUntilSettled(/Based on current active/);

  // Only Val-B did not vote (Val-A abstained, Val-C weighted voted)
  assert.match(text(mounted.container), /Based on current active \(bonded\) validators at height #500 \(2\/3 bonded validators voted/);
  assert.equal(rows(mounted.container).length, 1);
  assert.match(rows(mounted.container)[0], new RegExp(`Val-B${valB}`));

  // Height mismatch mid-pagination -> unavailable rather than partial non-voters
  heightMismatch = true;
  props.proposalId = '11';
  await nextTick();
  await waitUntilSettled(/Votes query height mismatch/);
  assert.match(text(mounted.container), /Votes query height mismatch/);

  // Closed proposal -> explicitly unavailable
  props.proposalStatus = 'PROPOSAL_STATUS_PASSED';
  await nextTick();
  await waitUntilSettled(/Unavailable for closed proposals/);
  assert.match(text(mounted.container), /Unavailable for closed proposals/);
});
