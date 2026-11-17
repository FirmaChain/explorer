import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextTick } from 'vue';
import {
  entry,
  fixture,
  opaque,
  page,
  product,
  unbonding,
  validator,
} from './helpers/validator-unbonding-fixture.mjs';
import {
  button,
  click,
  findAll,
  rows,
  text,
} from './helpers/validator-renderer.mjs';

test(
  'first success renders multiple entries per delegator with balances, completion times, account links, and bounded pagination',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    const request = await f.take();
    assert.match(text(f.container), /Loading unbonding delegations/);
    assert.match(
      text(f.container),
      /Active unbonding entries currently in progress/
    );
    assert.equal(button(f.container, 'Next').props.disabled, true);
    assert.equal(
      request.url.pathname,
      `/cosmos/staking/v1beta1/validators/${validator}/unbonding_delegations`
    );
    assert.deepEqual(
      [...request.url.searchParams],
      [['pagination.limit', '10']]
    );

    const t1 = '2026-12-01T00:00:00Z';
    const t2 = '2026-12-05T12:30:00Z';
    const t3 = '2026-12-10T06:15:00Z';
    await f.reply(
      request,
      page(
        [
          unbonding('firma1alice', [
            entry('123000000', t1, '101', '1'),
            entry('45000000', t2, '102', '2'),
          ]),
          unbonding('firma1bob', [entry('78000000', t3, '103', '3')]),
        ],
        opaque
      )
    );

    assert.deepEqual(rows(f.container), [
      `firma1alice123 FCT${f.formatter.toDay(t1, 'short')}`,
      `firma1alice45 FCT${f.formatter.toDay(t2, 'short')}`,
      `firma1bob78 FCT${f.formatter.toDay(t3, 'short')}`,
    ]);
    assert.deepEqual(
      findAll(f.container, (element) => element.type === 'a').map(
        (link) => link.props.href
      ),
      [
        '/firmachain/account/firma1alice',
        '/firmachain/account/firma1alice',
        '/firmachain/account/firma1bob',
      ]
    );
    assert.deepEqual(
      findAll(f.container, (element) => element.type === 'time').map(
        (node) => node.props.datetime
      ),
      [t1, t2, t3]
    );
    assert.equal(button(f.container, 'Previous').props.disabled, true);
    assert.equal(button(f.container, 'Next').props.disabled, false);
    assert.equal(f.requests.length, 1);
  }
);

test(
  'empty first page is a successful terminal state distinct from history',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page());
    assert.equal(rows(f.container).length, 0);
    assert.match(text(f.container), /No active unbonding delegations found/);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
    assert.equal(button(f.container, 'Next').props.disabled, true);
  }
);

test(
  'response with missing unbonding_responses or empty entries renders safely without crashing',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), {
      unbonding_responses: [unbonding('firma1empty', [])],
      pagination: { next_key: null },
    });
    assert.equal(rows(f.container).length, 0);
    assert.match(text(f.container), /No active unbonding delegations found/);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
  }
);

test(
  'first-page error exposes retry and recovers cleanly',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), {}, 503);
    assert.match(
      text(f.container),
      /Could not load unbonding delegations page 1.*503/
    );
    assert.doesNotMatch(
      text(f.container),
      /No active unbonding delegations found/
    );
    const retry = await f.take(() => click(button(f.container, 'Retry')));
    await f.reply(
      retry,
      page([unbonding('firma1recovered', [entry('25000000', '2026-12-02T00:00:00Z')])])
    );
    assert.equal(rows(f.container).length, 1);
    assert.match(rows(f.container)[0], /^firma1recovered25 FCT/);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
  }
);

test(
  'validator-level unbonding endpoint stays distinct from single-delegator unbonding endpoint',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page());

    const singlePathPromise = f.take(() => {
      void f.blockchain.rpc.getStakingValidatorsDelegationsUnbonding(
        validator,
        'firma1single'
      );
    });
    const singleRequest = await singlePathPromise;
    assert.equal(
      singleRequest.url.pathname,
      `/cosmos/staking/v1beta1/validators/${validator}/delegations/firma1single/unbonding_delegation`
    );
    singleRequest.response.writeHead(200, {
      'content-type': 'application/json',
    });
    singleRequest.response.end(JSON.stringify({ unbonding_response: {} }));

    const listRequest = await f.take(() => {
      void f.blockchain.rpc.getStakingValidatorsUnbondings(validator);
    });
    assert.equal(
      listRequest.url.pathname,
      `/cosmos/staking/v1beta1/validators/${validator}/unbonding_delegations`
    );
    assert.equal(listRequest.url.searchParams.get('pagination.limit'), '20');
    listRequest.response.writeHead(200, { 'content-type': 'application/json' });
    listRequest.response.end(JSON.stringify(page()));
  }
);

test(
  'multiple pages preserve distinct entries and opaque cursors through the real HTTP client',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    const t1 = '2026-12-01T00:00:00Z';
    const t2 = '2026-12-03T00:00:00Z';
    const t3 = '2026-12-04T00:00:00Z';
    await f.reply(
      await f.take(),
      page([unbonding('first', [entry('10000000', t1)])], opaque)
    );
    const second = await f.take(() => click(button(f.container, 'Next')));
    assert.deepEqual(rows(f.container), [
      `first10 FCT${f.formatter.toDay(t1, 'short')}`,
    ]);
    assert.equal(second.url.searchParams.get('pagination.key'), opaque);
    assert.deepEqual(
      [...second.url.searchParams],
      [
        ['pagination.key', opaque],
        ['pagination.limit', '10'],
      ]
    );
    await f.reply(
      second,
      page([
        unbonding('second', [
          entry('20000000', t2, '200', '1'),
          entry('30000000', t3, '201', '2'),
        ]),
      ])
    );
    assert.deepEqual(rows(f.container), [
      `second20 FCT${f.formatter.toDay(t2, 'short')}`,
      `second30 FCT${f.formatter.toDay(t3, 'short')}`,
    ]);
    assert.match(text(f.container), /Page 2/);
    assert.equal(button(f.container, 'Next').props.disabled, true);

    const previous = await f.take(() => click(button(f.container, 'Previous')));
    assert.deepEqual(rows(f.container), [
      `second20 FCT${f.formatter.toDay(t2, 'short')}`,
      `second30 FCT${f.formatter.toDay(t3, 'short')}`,
    ]);
    assert.equal(previous.url.searchParams.has('pagination.key'), false);
    await f.reply(
      previous,
      page([unbonding('first', [entry('10000000', t1)])], opaque)
    );
    assert.deepEqual(rows(f.container), [
      `first10 FCT${f.formatter.toDay(t1, 'short')}`,
    ]);
    assert.equal(f.requests.length, 3);
  }
);

test(
  'second-page failure remains an error and retry uses the failed cursor',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    const t1 = '2026-12-01T00:00:00Z';
    const t2 = '2026-12-02T00:00:00Z';
    await f.reply(
      await f.take(),
      page([unbonding('first', [entry('10000000', t1)])], opaque)
    );
    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(second, { message: 'fixture unavailable' }, 503);
    assert.match(
      text(f.container),
      /Could not load unbonding delegations page 2.*503/
    );
    assert.equal(rows(f.container).length, 0);
    assert.equal(button(f.container, 'Next').props.disabled, true);

    const retry = await f.take(() => click(button(f.container, 'Retry')));
    assert.equal(retry.url.searchParams.get('pagination.key'), opaque);
    await f.reply(
      retry,
      page([unbonding('recovered', [entry('99000000', t2)])])
    );
    assert.deepEqual(rows(f.container), [
      `recovered99 FCT${f.formatter.toDay(t2, 'short')}`,
    ]);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
  }
);

test(
  'empty intermediate page keeps navigation available without pretending the whole result is empty',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    const t2 = '2026-12-08T00:00:00Z';
    await f.reply(await f.take(), page([], opaque));
    assert.match(
      text(f.container),
      /No active unbonding delegations on this page/
    );
    assert.equal(button(f.container, 'Next').props.disabled, false);

    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(
      second,
      page([unbonding('after-empty', [entry('15000000', t2)])])
    );
    assert.deepEqual(rows(f.container), [
      `after-empty15 FCT${f.formatter.toDay(t2, 'short')}`,
    ]);
  }
);

test(
  'repeated cursor produces an error rather than an endless pagination loop',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(
      await f.take(),
      page([unbonding('first', [entry('10000000', '2026-12-01T00:00:00Z')])], opaque)
    );
    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(
      second,
      page([unbonding('loop', [entry('20000000', '2026-12-02T00:00:00Z')])], opaque)
    );
    assert.match(text(f.container), /repeated page cursor/);
    assert.deepEqual(rows(f.container), []);
    assert.equal(button(f.container, 'Next').props.disabled, true);
  }
);

describe('unbonding request lifecycle', () => {
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
        const tNew = '2026-12-12T00:00:00Z';
        await f.reply(
          current,
          page([unbonding('current', [entry('50000000', tNew)])])
        );
        await f.reply(
          old,
          outcome === 'success'
            ? page([unbonding('stale', [entry('1000000', '2026-12-01T00:00:00Z')])])
            : {},
          outcome === 'success' ? 200 : 500
        );
        assert.deepEqual(rows(f.container), [
          `current50 FCT${f.formatter.toDay(tNew, 'short')}`,
        ]);
        assert.equal(
          findAll(f.container, (element) => element.props.role === 'alert')
            .length,
          0
        );
        assert.equal(
          current.url.pathname,
          '/cosmos/staking/v1beta1/validators/new-validator/unbonding_delegations'
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
        const tOld = '2026-12-01T00:00:00Z';
        const tNew = '2026-12-15T00:00:00Z';
        await f.reply(
          await f.take(),
          page([unbonding('old-first', [entry('10000000', tOld)])], opaque)
        );
        const old = await f.take(() => click(button(f.container, 'Next')));
        const current = await f.take(() => {
          if (context === 'chain') {
            f.props.chain = 'testchain';
            f.blockchain.chainName = 'testchain';
          } else {
            f.blockchain.endpoint = {
              address: `${f.blockchain.rpc.endpoint}/new-node`,
            };
            f.blockchain.rpc = f.rpc('/new-node');
          }
        });
        assert.equal(current.url.searchParams.has('pagination.key'), false);
        assert.equal(
          current.url.pathname,
          `${context === 'endpoint' ? '/new-node' : ''}/cosmos/staking/v1beta1/validators/${validator}/unbonding_delegations`
        );
        await f.reply(
          old,
          page([unbonding('stale-page', [entry('20000000', tOld)])])
        );
        assert.match(text(f.container), /Loading unbonding delegations/);
        await f.reply(
          current,
          page([unbonding('new-first', [entry('30000000', tNew)])])
        );
        assert.deepEqual(rows(f.container), [
          `new-first30 FCT${f.formatter.toDay(tNew, 'short')}`,
        ]);
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
      await f.reply(
        old,
        page([unbonding('old', [entry('10000000', '2026-12-01T00:00:00Z')])])
      );
      assert.deepEqual(rows(f.container), []);
      assert.equal(f.requests.length, 1);

      const tReady = '2026-12-20T00:00:00Z';
      const current = await f.take(() => {
        f.blockchain.chainName = 'other';
      });
      await f.reply(
        current,
        page([unbonding('ready', [entry('40000000', tReady)])])
      );
      assert.deepEqual(rows(f.container), [
        `ready40 FCT${f.formatter.toDay(tReady, 'short')}`,
      ]);
    }
  );

  test(
    'unmount makes a pending response inert',
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t, product);
      const old = await f.take();
      f.app.unmount();
      await f.reply(
        old,
        page([unbonding('after-unmount', [entry('10000000', '2026-12-01T00:00:00Z')])])
      );
      assert.equal(text(f.container), '');
    }
  );
});

for (const state of ['success', 'empty', 'error']) {
  test(
    `detail route preserves delegations, voting power events, delegate and withdraw during unbonding ${state}`,
    { timeout: 10000 },
    async (t) => {
      const original = globalThis.localStorage;
      globalThis.localStorage = { getItem: () => null };
      t.after(() => {
        if (original === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = original;
      });
      const f = await fixture(t, product, true);
      const request = await f.take();
      const tDetail = '2026-12-25T09:00:00Z';
      await f.reply(
        request,
        state === 'success'
          ? page([unbonding('route-unbonder', [entry('88000000', tDetail)])])
          : page(),
        state === 'error' ? 503 : 200
      );

      assert.match(text(f.container), /7 FCT/);
      assert.match(text(f.container), /11 FCT/);
      if (state === 'success') {
        assert.match(text(f.container), /route-unbonder/);
        assert.match(text(f.container), /88 FCT/);
      } else if (state === 'empty') {
        assert.match(
          text(f.container),
          /No active unbonding delegations found/
        );
      } else {
        assert.match(
          text(f.container),
          /Could not load unbonding delegations page 1.*503/
        );
      }

      const delegate = findAll(
        f.container,
        (element) => element.props.for === 'delegate'
      )[0];
      const withdraw = findAll(
        f.container,
        (element) => element.props.for === 'withdraw_commission'
      )[0];
      click(delegate);
      click(withdraw);
      assert.deepEqual(f.actions, [
        ['delegate', { validator_address: validator }],
        ['withdraw_commission', { validator_address: validator }],
      ]);

      const unbondTab = findAll(
        f.container,
        (element) =>
          element.type === 'a' && text(element).trim() === 'account.btn_unbond'
      )[0];
      assert.ok(unbondTab);
      const powerNav = findAll(
        f.container,
        (element) => 'data-validator-power-events-pagination' in element.props
      )[0];
      assert.ok(powerNav);
      assert.match(text(powerNav), /Previous.*Page 1.*Next/);
      assert.equal(f.txCalls[0][2].limit, 10);
      click(unbondTab);
      assert.equal(f.txCalls.length, 2);
      assert.equal(f.txCalls[1][1].type, 'unbond');
      assert.equal(f.txCalls[1][2].limit, 10);
      assert.equal(f.requests.length, 1);
    }
  );
}
