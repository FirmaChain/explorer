import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('maps all legacy plural and singular paths to /:chain equivalents preserving query/hash without redirect loops', async () => {
  const {
    matchLegacyPath,
    resolveLegacyTargetChain,
    buildLegacyRedirect,
  } = await loadProduct('src/libs/legacyRoutes.ts');

  const singleChain = {
    firmachain: { chainName: 'firmachain', bech32Prefix: 'firma' },
  };

  const cases = [
    ['/blocks', '/firmachain/block'],
    ['/blocks/12345', '/firmachain/block/12345'],
    ['/transactions', '/firmachain/tx'],
    ['/transactions/ABCD', '/firmachain/tx/ABCD'],
    ['/transaction/ABCD', '/firmachain/tx/ABCD'],
    ['/proposals', '/firmachain/gov'],
    ['/proposals/13', '/firmachain/gov/13'],
    ['/validators', '/firmachain/staking'],
    ['/validators/firmavaloper1abc', '/firmachain/staking/firmavaloper1abc'],
    ['/validator/firmavaloper1abc', '/firmachain/staking/firmavaloper1abc'],
    ['/accounts/firma1xyz', '/firmachain/account/firma1xyz'],
    ['/account/firma1xyz', '/firmachain/account/firma1xyz'],
    ['/params', '/firmachain/params'],
  ];

  for (const [input, expected] of cases) {
    const redirect = buildLegacyRedirect(
      { path: input, query: { tab: '2' }, hash: '#sec' },
      singleChain,
      'firmachain'
    );
    assert.deepEqual(redirect, {
      path: expected,
      query: { tab: '2' },
      hash: '#sec',
      replace: true,
    });
    // Running guard again on the destination path must NOT match or loop
    assert.equal(matchLegacyPath(expected), null);
  }

  // Multi-chain without explicit selection or unique FIRMACHAIN match must NOT guess arbitrarily
  const ambiguousChains = {
    cosmos: { chainName: 'cosmos', bech32Prefix: 'cosmos' },
    osmosis: { chainName: 'osmosis', bech32Prefix: 'osmo' },
  };
  assert.equal(resolveLegacyTargetChain(ambiguousChains, ''), null);
  assert.equal(
    buildLegacyRedirect({ path: '/blocks' }, ambiguousChains, ''),
    null
  );

  // Explicit configured chain resolves even in multi-chain setup
  assert.equal(resolveLegacyTargetChain(ambiguousChains, 'osmosis'), 'osmosis');

  // Verify real Vue Router priority over /:chain dynamic route
  const seenChains = [];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/:chain', component: { render: () => null } },
      { path: '/:chain/block/:height', component: { render: () => null } },
      { path: '/:chain/staking/:validator', component: { render: () => null } },
    ],
  });
  router.beforeEach((to) => {
    const redirect = buildLegacyRedirect(to, singleChain, 'firmachain');
    if (redirect) return redirect;
    if (to.params.chain) seenChains.push(to.params.chain);
  });

  await router.push('/blocks/77?view=1#top');
  assert.equal(router.currentRoute.value.fullPath, '/firmachain/block/77?view=1#top');
  assert.deepEqual(seenChains, ['firmachain']);

  await router.push('/validator/firmavaloper1abc');
  assert.equal(router.currentRoute.value.fullPath, '/firmachain/staking/firmavaloper1abc');
});
