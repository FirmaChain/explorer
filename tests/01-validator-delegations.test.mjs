import assert from 'node:assert/strict';
import { test } from 'node:test';
import './validator-delegation-context.mjs';
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

test(
  'first success renders exact addresses, formatted amounts and account links with bounded demand',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    const request = await f.take();
    assert.match(text(f.container), /Loading delegations/);
    assert.equal(button(f.container, 'Next').props.disabled, true);
    assert.equal(
      request.url.pathname,
      `/cosmos/staking/v1beta1/validators/${validator}/delegations`
    );
    assert.deepEqual(
      [...request.url.searchParams],
      [['pagination.limit', '10']]
    );
    await f.reply(
      request,
      page([row('firma1alice'), row('firma1bob', '456000000')], opaque)
    );
    assert.deepEqual(rows(f.container), [
      'firma1alice123 FCT',
      'firma1bob456 FCT',
    ]);
    assert.deepEqual(
      findAll(f.container, (element) => element.type === 'a').map(
        (link) => link.props.href
      ),
      ['/firmachain/account/firma1alice', '/firmachain/account/firma1bob']
    );
    assert.equal(button(f.container, 'Previous').props.disabled, true);
    assert.equal(button(f.container, 'Next').props.disabled, false);
    assert.equal(f.requests.length, 1);
  }
);

test(
  'empty first page is a successful terminal state',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page());
    assert.equal(rows(f.container).length, 0);
    assert.match(text(f.container), /No delegations found/);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
    assert.equal(button(f.container, 'Next').props.disabled, true);
  }
);

test(
  'first-page error exposes retry and can recover to an empty success',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), {}, 503);
    assert.match(text(f.container), /Could not load delegation page 1.*503/);
    assert.doesNotMatch(text(f.container), /No delegations found/);
    const retry = await f.take(() => click(button(f.container, 'Retry')));
    await f.reply(retry, page());
    assert.match(text(f.container), /No delegations found/);
    assert.equal(
      findAll(f.container, (element) => element.props.role === 'alert').length,
      0
    );
  }
);

test('PageRequest public query format preserves opaque keys and suppresses offset', () => {
  const request = new product.types.PageRequest();
  request.key = opaque;
  request.offset = 90;
  request.limit = 10;
  request.count_total = false;
  const query = new URLSearchParams(request.toQueryString());
  assert.deepEqual(
    [...query],
    [
      ['pagination.key', opaque],
      ['pagination.limit', '10'],
    ]
  );
});

test(
  'multiple pages preserve distinct delegators and opaque cursors through the real HTTP client',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page([row('first')], opaque));
    const second = await f.take(() => click(button(f.container, 'Next')));
    assert.deepEqual(rows(f.container), ['first123 FCT']);
    // The fixture only supplies page two for the cursor the server issued.
    assert.equal(second.url.searchParams.get('pagination.key'), opaque);
    assert.deepEqual(
      [...second.url.searchParams],
      [
        ['pagination.key', opaque],
        ['pagination.limit', '10'],
      ]
    );
    await f.reply(second, page([row('second'), row('third')]));
    assert.deepEqual(rows(f.container), ['second123 FCT', 'third123 FCT']);
    assert.match(text(f.container), /Page 2/);
    assert.equal(button(f.container, 'Next').props.disabled, true);
    const previous = await f.take(() => click(button(f.container, 'Previous')));
    assert.deepEqual(rows(f.container), ['second123 FCT', 'third123 FCT']);
    assert.equal(previous.url.searchParams.has('pagination.key'), false);
    await f.reply(previous, page([row('first')], opaque));
    assert.deepEqual(rows(f.container), ['first123 FCT']);
    assert.equal(f.requests.length, 3);
  }
);

test(
  'second-page failure remains an error and retry uses the failed cursor',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page([row('first')], opaque));
    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(second, { message: 'fixture unavailable' }, 503);
    assert.match(text(f.container), /Could not load delegation page 2.*503/);
    assert.equal(rows(f.container).length, 0);
    assert.equal(button(f.container, 'Next').props.disabled, true);
    const retry = await f.take(() => click(button(f.container, 'Retry')));
    assert.equal(retry.url.searchParams.get('pagination.key'), opaque);
    await f.reply(retry, page([row('recovered')]));
    assert.deepEqual(rows(f.container), ['recovered123 FCT']);
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
    await f.reply(await f.take(), page([], opaque));
    assert.match(text(f.container), /No delegations on this page/);
    assert.equal(button(f.container, 'Next').props.disabled, false);
    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(second, page([row('after-empty')]));
    assert.deepEqual(rows(f.container), ['after-empty123 FCT']);
  }
);

test(
  'repeated cursor produces an error rather than an endless pagination loop',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, product);
    await f.reply(await f.take(), page([row('first')], opaque));
    const second = await f.take(() => click(button(f.container, 'Next')));
    await f.reply(second, page([row('untrusted-page')], opaque));
    assert.match(text(f.container), /repeated page cursor/);
    assert.deepEqual(rows(f.container), []);
    assert.equal(button(f.container, 'Next').props.disabled, true);
  }
);

for (const state of ['success', 'empty', 'error']) {
  test(
    `detail route preserves delegate, commission withdrawal and fees during ${state}`,
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
      await f.reply(
        request,
        state === 'success' ? page([row('route-account')]) : page(),
        state === 'error' ? 503 : 200
      );
      assert.match(text(f.container), /7 FCT/);
      assert.match(text(f.container), /11 FCT/);
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
      assert.equal(f.requests.length, 1);
    }
  );
}
