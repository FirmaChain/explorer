import {
  PRICE_ERROR_COOLDOWN_MS,
  PRICE_MIN_REQUEST_GAP_MS,
  PRICE_REFRESH_INTERVAL_MS,
  createCacheApiStorage,
  createPriceFetcher,
} from '@/libs/priceCache';

export type PriceWorkerInbound =
  | { type: 'fetch'; requestId: number; url: string; forceRefresh?: boolean }
  | { type: 'subscribe'; url: string; intervalMs?: number }
  | { type: 'unsubscribe'; url: string };

export type PriceWorkerOutbound =
  | {
      type: 'response';
      requestId: number;
      ok: true;
      data: any;
      fetchedAt: number;
      fromCache: boolean;
      stale: boolean;
    }
  | { type: 'response'; requestId: number; ok: false; error: string }
  | {
      type: 'update';
      url: string;
      ok: true;
      data: any;
      fetchedAt: number;
      fromCache: boolean;
      stale: boolean;
    }
  | { type: 'update'; url: string; ok: false; error: string };

interface SubscriptionEntry {
  refCount: number;
  intervalMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PriceWorkerInbound>) => void) | null;
  postMessage: (message: PriceWorkerOutbound) => void;
};

const fetcher = createPriceFetcher({
  ttlMs: PRICE_REFRESH_INTERVAL_MS,
  minRequestGapMs: PRICE_MIN_REQUEST_GAP_MS,
  errorCooldownMs: PRICE_ERROR_COOLDOWN_MS,
  storage: createCacheApiStorage(),
});

const subscriptions = new Map<string, SubscriptionEntry>();

function clearSubTimer(sub: SubscriptionEntry) {
  if (sub.timer !== null) {
    clearTimeout(sub.timer);
    sub.timer = null;
  }
}

function scheduleNext(url: string, delayMs: number) {
  const sub = subscriptions.get(url);
  if (!sub || sub.refCount <= 0) return;

  clearSubTimer(sub);
  const safeDelay = Math.max(100, delayMs);
  sub.timer = setTimeout(() => {
    void refreshSubscription(url, true);
  }, safeDelay);
}

async function refreshSubscription(url: string, forceRefresh: boolean) {
  const sub = subscriptions.get(url);
  if (!sub || sub.refCount <= 0) return;

  try {
    const result = await fetcher.get(url, { forceRefresh });
    if (!subscriptions.has(url)) return;
    workerScope.postMessage({
      type: 'update',
      url,
      ok: true,
      data: result.data,
      fetchedAt: result.fetchedAt,
      fromCache: result.fromCache,
      stale: result.stale,
    });
    const nextDelay = forceRefresh
      ? Math.max(sub.intervalMs, result.nextRefreshInMs)
      : Math.min(sub.intervalMs, result.nextRefreshInMs);
    scheduleNext(url, nextDelay);
  } catch (cause) {
    if (!subscriptions.has(url)) return;
    workerScope.postMessage({
      type: 'update',
      url,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    scheduleNext(url, Math.max(sub.intervalMs, PRICE_ERROR_COOLDOWN_MS));
  }
}

workerScope.onmessage = (event: MessageEvent<PriceWorkerInbound>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'fetch') {
    void fetcher
      .get(msg.url, { forceRefresh: msg.forceRefresh })
      .then((result) => {
        workerScope.postMessage({
          type: 'response',
          requestId: msg.requestId,
          ok: true,
          data: result.data,
          fetchedAt: result.fetchedAt,
          fromCache: result.fromCache,
          stale: result.stale,
        });
      })
      .catch((cause) => {
        workerScope.postMessage({
          type: 'response',
          requestId: msg.requestId,
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    return;
  }

  if (msg.type === 'subscribe') {
    const intervalMs = msg.intervalMs ?? PRICE_REFRESH_INTERVAL_MS;
    const existing = subscriptions.get(msg.url);
    if (existing) {
      existing.refCount += 1;
      void fetcher
        .get(msg.url)
        .then((result) => {
          if (!subscriptions.has(msg.url)) return;
          workerScope.postMessage({
            type: 'update',
            url: msg.url,
            ok: true,
            data: result.data,
            fetchedAt: result.fetchedAt,
            fromCache: result.fromCache,
            stale: result.stale,
          });
        })
        .catch(() => {});
      return;
    }

    subscriptions.set(msg.url, {
      refCount: 1,
      intervalMs,
      timer: null,
    });
    void refreshSubscription(msg.url, false);
    return;
  }

  if (msg.type === 'unsubscribe') {
    const sub = subscriptions.get(msg.url);
    if (!sub) return;
    sub.refCount -= 1;
    if (sub.refCount <= 0) {
      clearSubTimer(sub);
      subscriptions.delete(msg.url);
    }
  }
};
