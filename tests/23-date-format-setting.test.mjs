import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import dayjs from 'dayjs';
import { loadProduct, mount } from './helpers/validator-renderer.mjs';
import { click, findAll, text } from './helpers/validator-renderer.mjs';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

test('defaults to locale, switches to UTC, preserves relative times, persists across reloads, and falls back on invalid storage', async (t) => {
  const originalStorage = globalThis.localStorage;
  const storage = makeStorage({ 'explorer:dateFormat': 'invalid-value' });
  globalThis.localStorage = storage;
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const stores = {
    useBlockchain: () => ({ current: { assets: [] } }),
    useStakingStore: () => ({ validators: [] }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };

  setActivePinia(createPinia());
  const mod = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  const formatter = mod.useFormatter();
  const instant = '2026-11-17T15:30:45Z';

  // Invalid stored value falls back to default 'locale'
  assert.equal(formatter.dateFormat, 'locale');
  assert.equal(
    formatter.toDay(instant, 'short'),
    dayjs(instant).format('YYYY-MM-DD HH:mm:ss')
  );

  const relativeBefore = formatter.toDay(instant, 'from');

  // Toggle via NavbarDateFormat UI component
  const toggleComp = (
    await loadProduct('src/layouts/components/NavbarDateFormat.vue', {
      '@/stores': { useFormatter: () => formatter },
    })
  ).default;
  const mounted = mount(toggleComp, {});
  t.after(() => mounted.app.unmount());

  assert.equal(text(mounted.container).trim(), 'Local');
  click(findAll(mounted.container, (el) => el.type === 'button')[0]);
  await nextTick();

  assert.equal(text(mounted.container).trim(), 'UTC');
  assert.equal(formatter.dateFormat, 'utc');
  assert.equal(storage.dump()['explorer:dateFormat'], 'utc');
  assert.equal(formatter.toDay(instant, 'short'), '2026-11-17 15:30:45 UTC');
  assert.equal(formatter.toDay(instant, 'long'), '2026-11-17 15:30 UTC');
  assert.equal(formatter.toDay(instant, 'date'), '2026-11-17');
  assert.equal(formatter.toDay(instant, 'time'), '15:30:45 UTC');
  // Relative time remains invariant
  assert.equal(formatter.toDay(instant, 'from'), relativeBefore);

  // Simulated reload restores 'utc'
  setActivePinia(createPinia());
  const modReloaded = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  const reloadedFormatter = modReloaded.useFormatter();
  assert.equal(reloadedFormatter.dateFormat, 'utc');
  assert.equal(
    reloadedFormatter.toDay(instant, 'short'),
    '2026-11-17 15:30:45 UTC'
  );
});
