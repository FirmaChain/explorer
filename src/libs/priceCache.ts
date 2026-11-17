export const PRICE_REFRESH_INTERVAL_MS = 60_000;
export const PRICE_MIN_REQUEST_GAP_MS = 2_000;
export const PRICE_ERROR_COOLDOWN_MS = 60_000;
export const PRICE_CACHE_NAME = 'firmachain-price-cache-v1';
const COOLDOWN_CACHE_KEY = 'https://firmachain-price-cache.invalid/__cooldown__';

export interface CachedPriceEntry<T = any> {
  fetchedAt: number;
  data: T;
}

export interface PriceCacheStorage {
  read(url: string): Promise<CachedPriceEntry | null>;
  write(url: string, entry: CachedPriceEntry): Promise<void>;
}

export interface PriceFetchResult<T = any> {
  data: T;
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
  nextRefreshInMs: number;
}

export function createMemoryPriceStorage(): PriceCacheStorage {
  const memory = new Map<string, CachedPriceEntry>();
  return {
    async read(url: string) {
      return memory.get(url) ?? null;
    },
    async write(url: string, entry: CachedPriceEntry) {
      memory.set(url, entry);
    },
  };
}

export function createCacheApiStorage(
  cacheName = PRICE_CACHE_NAME
): PriceCacheStorage {
  const memory = new Map<string, CachedPriceEntry>();
  let cachePromise: Promise<Cache | null> | null = null;

  function openCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    if (!cachePromise) {
      cachePromise = caches.open(cacheName).catch(() => null);
    }
    return cachePromise;
  }

  return {
    async read(url: string) {
      const mem = memory.get(url);
      if (mem) return mem;

      const cache = await openCache();
      if (!cache) return null;

      try {
        const matched = await cache.match(url);
        if (!matched) return null;
        const parsed = (await matched.json()) as Partial<CachedPriceEntry>;
        if (
          typeof parsed?.fetchedAt !== 'number' ||
          !Number.isFinite(parsed.fetchedAt) ||
          !('data' in parsed)
        ) {
          return null;
        }
        const entry: CachedPriceEntry = {
          fetchedAt: parsed.fetchedAt,
          data: parsed.data,
        };
        memory.set(url, entry);
        return entry;
      } catch {
        return null;
      }
    },

    async write(url: string, entry: CachedPriceEntry) {
      memory.set(url, entry);
      const cache = await openCache();
      if (!cache) return;

      try {
        const response = new Response(JSON.stringify(entry), {
          headers: { 'Content-Type': 'application/json' },
        });
        await cache.put(url, response);
      } catch {
        // Ignore quota / CacheStorage write errors; in-memory entry remains valid
      }
    },
  };
}

async function defaultJsonFetcher(url: string): Promise<any> {
  const res = await fetch(url, { referrerPolicy: 'origin-when-cross-origin' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPriceFetcher(options?: {
  ttlMs?: number;
  minRequestGapMs?: number;
  errorCooldownMs?: number;
  storage?: PriceCacheStorage;
  fetcher?: (url: string) => Promise<any>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}) {
  const ttlMs = options?.ttlMs ?? PRICE_REFRESH_INTERVAL_MS;
  const minRequestGapMs = options?.minRequestGapMs ?? 0;
  const errorCooldownMs = options?.errorCooldownMs ?? 0;
  const storage = options?.storage ?? createCacheApiStorage();
  const fetcher = options?.fetcher ?? defaultJsonFetcher;
  const now = options?.now ?? (() => Date.now());
  const wait = options?.wait ?? defaultWait;

  const inFlight = new Map<string, Promise<PriceFetchResult>>();
  let networkTail: Promise<void> = Promise.resolve();
  let lastFetchFinishedAt = -Infinity;
  let cooldownUntil = 0;
  let cooldownError = 'Price API rate-limit cooldown active';
  let cooldownLoaded = false;

  async function readActiveCooldown(): Promise<number> {
    if (!errorCooldownMs) return 0;
    if (!cooldownLoaded) {
      cooldownLoaded = true;
      const stored = await storage.read(COOLDOWN_CACHE_KEY);
      if (stored && typeof stored.fetchedAt === 'number') {
        cooldownUntil = stored.fetchedAt;
        if (typeof stored.data === 'string' && stored.data) {
          cooldownError = stored.data;
        }
      }
    }
    return cooldownUntil > now() ? cooldownUntil : 0;
  }

  function enqueueNetwork<T>(task: () => Promise<T>): Promise<T> {
    const run = networkTail.then(async () => {
      if (minRequestGapMs > 0 && Number.isFinite(lastFetchFinishedAt)) {
        const waitMs = minRequestGapMs - (now() - lastFetchFinishedAt);
        if (waitMs > 0) {
          await wait(waitMs);
        }
      }
      try {
        return await task();
      } finally {
        lastFetchFinishedAt = now();
      }
    });
    networkTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function get<T = any>(
    url: string,
    opts?: { forceRefresh?: boolean }
  ): Promise<PriceFetchResult<T>> {
    const cached = await storage.read(url);
    const ts = now();

    if (!opts?.forceRefresh && cached && ts - cached.fetchedAt < ttlMs) {
      const elapsed = Math.max(0, ts - cached.fetchedAt);
      return {
        data: cached.data as T,
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        stale: false,
        nextRefreshInMs: Math.max(0, ttlMs - elapsed),
      };
    }

    const activeCooldownUntil = await readActiveCooldown();
    if (activeCooldownUntil > ts) {
      const remaining = Math.max(ttlMs, activeCooldownUntil - ts);
      if (cached) {
        return {
          data: cached.data as T,
          fetchedAt: cached.fetchedAt,
          fromCache: true,
          stale: true,
          nextRefreshInMs: remaining,
        };
      }
      throw new Error(cooldownError);
    }

    const pending = inFlight.get(url);
    if (pending) return pending as Promise<PriceFetchResult<T>>;

    const job = enqueueNetwork<PriceFetchResult<T>>(async () => {
      // Re-check cooldown inside the queue in case the immediately preceding
      // queued request triggered a 429/CORS block.
      const queuedCooldownUntil = await readActiveCooldown();
      const currentTs = now();
      if (queuedCooldownUntil > currentTs) {
        const remaining = Math.max(ttlMs, queuedCooldownUntil - currentTs);
        if (cached) {
          return {
            data: cached.data as T,
            fetchedAt: cached.fetchedAt,
            fromCache: true,
            stale: true,
            nextRefreshInMs: remaining,
          };
        }
        throw new Error(cooldownError);
      }

      try {
        const data = (await fetcher(url)) as T;
        const fetchedAt = now();
        await storage.write(url, { fetchedAt, data });
        return {
          data,
          fetchedAt,
          fromCache: false,
          stale: false,
          nextRefreshInMs: ttlMs,
        };
      } catch (err) {
        if (errorCooldownMs > 0) {
          const message = err instanceof Error ? err.message : String(err);
          cooldownError = message;
          cooldownUntil = now() + errorCooldownMs;
          await storage.write(COOLDOWN_CACHE_KEY, {
            fetchedAt: cooldownUntil,
            data: message,
          });
        }
        if (cached) {
          return {
            data: cached.data as T,
            fetchedAt: cached.fetchedAt,
            fromCache: true,
            stale: true,
            nextRefreshInMs: Math.max(ttlMs, errorCooldownMs),
          };
        }
        throw err;
      }
    }).finally(() => {
      inFlight.delete(url);
    });

    inFlight.set(url, job);
    return job;
  }

  return { get, ttlMs };
}
