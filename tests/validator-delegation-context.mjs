import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextTick } from 'vue';
import {
  fixture,
  opaque,
  page,
  row,
  product,
  validator,
} from './helpers/validator-fixture.mjs';
import {
  button,
  click,
  findAll,
  rows,
  text,
} from './helpers/validator-renderer.mjs';

describe('delegation request lifecycle', () => {
  for (const outcome of ['success', 'failure']) {
    test(
      `late ${outcome} cannot replace a new validator's successful page`,
      { timeout: 10000 },
      async (t) => {
        const f = await fixture(t, product);
        const old = await f.take();
        const current = await f.take(() => {
          f.props.validator = 'new-validator';
        });
        await f.reply(current, page([row('current')]));
        await f.reply(
          old,
          outcome === 'success' ? page([row('stale')]) : {},
          outcome === 'success' ? 200 : 500
        );
        assert.deepEqual(rows(f.container), ['current123 FCT']);
        assert.equal(
          findAll(f.container, (element) => element.props.role === 'alert')
            .length,
          0
        );
        assert.equal(
          current.url.pathname,
          '/cosmos/staking/v1beta1/validators/new-validator/delegations'
        );
      }
    );
  }

  for (const context of ['chain', 'endpoint']) {
    test(
      `${context} switch invalidates pending pages and resets the cursor`,
      { timeout: 10000 },
      async (t) => {
        const f = await fixture(t, product);
        await f.reply(await f.take(), page([row('old-first')], opaque));
        const old = await f.take(() => click(button(f.container, 'Next')));
        const current = await f.take(() => {
          if (context === 'chain') {
            f.props.chain = 'testchain';
            f.blockchain.chainName = 'testchain';
          } else {
            // Match setRestEndpoint's endpoint-before-client assignment.
            f.blockchain.endpoint = {
              address: `${f.blockchain.rpc.endpoint}/new-node`,
            };
            f.blockchain.rpc = f.rpc('/new-node');
          }
        });
        assert.equal(current.url.searchParams.has('pagination.key'), false);
        assert.equal(
          current.url.pathname,
          `${context === 'endpoint' ? '/new-node' : ''}/cosmos/staking/v1beta1/validators/${validator}/delegations`
        );
        await f.reply(old, page([row('stale-page')]));
        assert.match(text(f.container), /Loading delegations/);
        await f.reply(current, page([row('new-first')]));
        assert.deepEqual(rows(f.container), ['new-first123 FCT']);
        assert.match(text(f.container), /Page 1/);
        const link = findAll(f.container, (element) => element.type === 'a')[0];
        assert.equal(
          link.props.href,
          `/${context === 'chain' ? 'testchain' : 'firmachain'}/account/new-first`
        );
      }
    );
  }

  test(
    'mismatched chain waits until the matching store context is ready',
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, product);
      const old = await f.take();
      f.props.chain = 'other';
      await nextTick();
      await f.reply(old, page([row('old')]));
      assert.deepEqual(rows(f.container), []);
      assert.equal(f.requests.length, 1);
      const current = await f.take(() => {
        f.blockchain.chainName = 'other';
      });
      await f.reply(current, page([row('ready')]));
      assert.deepEqual(rows(f.container), ['ready123 FCT']);
    }
  );

  test(
    'unmount makes a pending response inert',
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, product);
      const old = await f.take();
      f.app.unmount();
      await f.reply(old, page([row('after-unmount')]));
      assert.equal(text(f.container), '');
    }
  );
});
