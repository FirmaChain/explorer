import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProduct } from './helpers/validator-renderer.mjs';

test('price fetcher caches across reloads for 60s, deduplicates in-flight, and falls back to stale cache on errors', async () => {
  const { createMemoryPriceStorage, createPriceFetcher, PRICE_REFRESH_INTERVAL_MS } =
    await loadProduct('src/libs/priceCache.ts');

  assert.equal(PRICE_REFRESH_INTERVAL_MS, 60_000);

  const sharedStorage = createMemoryPriceStorage();
  let currentTime = 1_000_000;
  let fetchCount = 0;
  let shouldFail = false;

  const mockFetcher = async () => {
    fetchCount += 1;
    if (shouldFail) throw new Error('HTTP 429');
    return { firmachain: { usd: 0.05 * fetchCount } };
  };

  // First session loads from network
  const session1 = createPriceFetcher({
    ttlMs: PRICE_REFRESH_INTERVAL_MS,
    storage: sharedStorage,
    fetcher: mockFetcher,
    now: () => currentTime,
  });

  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=firmachain';
  const [r1, r2] = await Promise.all([session1.get(url), session1.get(url)]);
  assert.equal(fetchCount, 1);
  assert.equal(r1.fromCache, false);
  assert.equal(r2.fromCache, false);
  assert.deepEqual(r1.data, { firmachain: { usd: 0.05 } });
  assert.equal(r1.nextRefreshInMs, 60_000);

  // Page reload 12s later -> new fetcher instance with shared persistent storage makes 0 network calls
  currentTime += 12_000;
  const session2 = createPriceFetcher({
    ttlMs: PRICE_REFRESH_INTERVAL_MS,
    storage: sharedStorage,
    fetcher: mockFetcher,
    now: () => currentTime,
  });

  const reloadHit = await session2.get(url);
  assert.equal(fetchCount, 1);
  assert.equal(reloadHit.fromCache, true);
  assert.equal(reloadHit.stale, false);
  assert.equal(reloadHit.nextRefreshInMs, 48_000);
  assert.deepEqual(reloadHit.data, { firmachain: { usd: 0.05 } });

  // After remaining 48s (total 60s elapsed), fetches fresh data
  currentTime += 48_000;
  const expiredHit = await session2.get(url);
  assert.equal(fetchCount, 2);
  assert.equal(expiredHit.fromCache, false);
  assert.deepEqual(expiredHit.data, { firmachain: { usd: 0.1 } });

  // After another 60s, if CoinGecko returns 429/error, falls back gracefully to stale cached value
  currentTime += 60_000;
  shouldFail = true;
  const staleHit = await session2.get(url);
  assert.equal(fetchCount, 3);
  assert.equal(staleHit.fromCache, true);
  assert.equal(staleHit.stale, true);
  assert.deepEqual(staleHit.data, { firmachain: { usd: 0.1 } });

  // Uncached URL failure still rejects cleanly
  await assert.rejects(
    session2.get('https://api.coingecko.com/api/v3/coins/unknown'),
    /HTTP 429/
  );
});

test('price fetcher spaces concurrent distinct requests and persists error cooldown across reloads', async () => {
  const {
    createMemoryPriceStorage,
    createPriceFetcher,
    PRICE_ERROR_COOLDOWN_MS,
    PRICE_MIN_REQUEST_GAP_MS,
    PRICE_REFRESH_INTERVAL_MS,
  } = await loadProduct('src/libs/priceCache.ts');

  const sharedStorage = createMemoryPriceStorage();
  let currentTime = 5_000_000;
  const waits = [];
  const calls = [];

  const session1 = createPriceFetcher({
    ttlMs: PRICE_REFRESH_INTERVAL_MS,
    minRequestGapMs: PRICE_MIN_REQUEST_GAP_MS,
    errorCooldownMs: PRICE_ERROR_COOLDOWN_MS,
    storage: sharedStorage,
    now: () => currentTime,
    wait: async (ms) => {
      waits.push(ms);
      currentTime += ms;
    },
    fetcher: async (url) => {
      calls.push({ url, at: currentTime });
      if (url.includes('fail')) throw new Error('HTTP 429');
      return { ok: true };
    },
  });

  await Promise.all([
    session1.get('https://api.coingecko.com/a'),
    session1.get('https://api.coingecko.com/b'),
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [PRICE_MIN_REQUEST_GAP_MS]);
  assert.equal(calls[1].at - calls[0].at, PRICE_MIN_REQUEST_GAP_MS);

  // When a 429/CORS failure occurs, subsequent uncached requests during cooldown do not hit network
  await assert.rejects(
    session1.get('https://api.coingecko.com/fail'),
    /HTTP 429/
  );
  assert.equal(calls.length, 3);

  // Even across a simulated reload (new fetcher instance) within 60s cooldown, network stays idle
  currentTime += 10_000;
  const session2 = createPriceFetcher({
    ttlMs: PRICE_REFRESH_INTERVAL_MS,
    minRequestGapMs: PRICE_MIN_REQUEST_GAP_MS,
    errorCooldownMs: PRICE_ERROR_COOLDOWN_MS,
    storage: sharedStorage,
    now: () => currentTime,
    fetcher: async (url) => {
      calls.push({ url, at: currentTime });
      return { recovered: true };
    },
  });

  await assert.rejects(
    session2.get('https://api.coingecko.com/another'),
    /HTTP 429/
  );
  assert.equal(calls.length, 3);

  // Cached URL from before failure still resolves stale data during cooldown
  const cachedDuringCooldown = await session2.get('https://api.coingecko.com/a', {
    forceRefresh: true,
  });
  assert.equal(cachedDuringCooldown.stale, true);
  assert.deepEqual(cachedDuringCooldown.data, { ok: true });
  assert.equal(calls.length, 3);

  // Once cooldown expires (> 60s from failure), requests resume
  currentTime += PRICE_ERROR_COOLDOWN_MS;
  const recovered = await session2.get('https://api.coingecko.com/another');
  assert.deepEqual(recovered.data, { recovered: true });
  assert.equal(calls.length, 4);
});
