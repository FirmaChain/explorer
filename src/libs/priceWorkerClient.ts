import PriceWorker from '@/workers/priceWorker?worker';
import {
  PRICE_ERROR_COOLDOWN_MS,
  PRICE_MIN_REQUEST_GAP_MS,
  PRICE_REFRESH_INTERVAL_MS,
  createCacheApiStorage,
  createPriceFetcher,
} from '@/libs/priceCache';
import type {
  PriceWorkerInbound,
  PriceWorkerOutbound,
} from '@/workers/priceWorker';

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
}

interface Listener<T = any> {
  onData: (data: T) => void;
  onError?: (err: Error) => void;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextRequestId = 1;

const pending = new Map<number, PendingRequest>();
const subscribers = new Map<string, Set<Listener>>();
const fallbackSubscriptions = new Map<string, ReturnType<typeof setTimeout>>();

let fallbackFetcher: ReturnType<typeof createPriceFetcher> | null = null;

function getFallbackFetcher() {
  if (!fallbackFetcher) {
    fallbackFetcher = createPriceFetcher({
      ttlMs: PRICE_REFRESH_INTERVAL_MS,
      minRequestGapMs: PRICE_MIN_REQUEST_GAP_MS,
      errorCooldownMs: PRICE_ERROR_COOLDOWN_MS,
      storage: createCacheApiStorage(),
    });
  }
  return fallbackFetcher;
}

function handleWorkerMessage(event: MessageEvent<PriceWorkerOutbound>) {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'response') {
    const req = pending.get(msg.requestId);
    if (!req) return;
    pending.delete(msg.requestId);
    if (msg.ok) {
      req.resolve(msg.data);
    } else {
      req.reject(new Error(msg.error));
    }
    return;
  }

  if (msg.type === 'update') {
    const listeners = subscribers.get(msg.url);
    if (!listeners || listeners.size === 0) return;
    if (msg.ok) {
      listeners.forEach((l) => l.onData(msg.data));
    } else {
      const err = new Error(msg.error);
      listeners.forEach((l) => l.onError?.(err));
    }
  }
}

function ensureWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (worker) return worker;

  try {
    const instance = new PriceWorker();
    instance.onmessage = handleWorkerMessage;
    instance.onerror = () => {
      // Fall back to direct cached fetcher if the worker hits a runtime error
      workerFailed = true;
      worker = null;
    };
    worker = instance;
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export async function fetchPriceCached<T = any>(
  url: string,
  options?: { forceRefresh?: boolean }
): Promise<T> {
  const w = ensureWorker();
  if (!w) {
    const result = await getFallbackFetcher().get<T>(url, options);
    return result.data;
  }

  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    const message: PriceWorkerInbound = {
      type: 'fetch',
      requestId,
      url,
      forceRefresh: options?.forceRefresh,
    };
    w.postMessage(message);
  });
}

function runFallbackLoop(url: string, intervalMs: number, forceRefresh: boolean) {
  const listeners = subscribers.get(url);
  if (!listeners || listeners.size === 0) {
    fallbackSubscriptions.delete(url);
    return;
  }

  void getFallbackFetcher()
    .get(url, { forceRefresh })
    .then((result) => {
      const current = subscribers.get(url);
      if (!current || current.size === 0) return;
      current.forEach((l) => l.onData(result.data));
      const delay = forceRefresh
        ? intervalMs
        : Math.min(intervalMs, result.nextRefreshInMs);
      const timer = setTimeout(
        () => runFallbackLoop(url, intervalMs, true),
        Math.max(100, delay)
      );
      fallbackSubscriptions.set(url, timer);
    })
    .catch((cause) => {
      const current = subscribers.get(url);
      if (!current || current.size === 0) return;
      const err = cause instanceof Error ? cause : new Error(String(cause));
      current.forEach((l) => l.onError?.(err));
      const timer = setTimeout(
        () => runFallbackLoop(url, intervalMs, true),
        intervalMs
      );
      fallbackSubscriptions.set(url, timer);
    });
}

export function subscribePrice<T = any>(
  url: string,
  onData: (data: T) => void,
  onError?: (err: Error) => void,
  intervalMs = PRICE_REFRESH_INTERVAL_MS
): () => void {
  const listener: Listener<T> = { onData, onError };
  let set = subscribers.get(url);
  if (!set) {
    set = new Set();
    subscribers.set(url, set);
  }
  set.add(listener);

  const w = ensureWorker();
  if (w) {
    const message: PriceWorkerInbound = {
      type: 'subscribe',
      url,
      intervalMs,
    };
    w.postMessage(message);
  } else if (!fallbackSubscriptions.has(url)) {
    runFallbackLoop(url, intervalMs, false);
  } else {
    void getFallbackFetcher()
      .get<T>(url)
      .then((res) => {
        if (subscribers.get(url)?.has(listener)) {
          onData(res.data);
        }
      })
      .catch((cause) => {
        if (subscribers.get(url)?.has(listener)) {
          onError?.(cause instanceof Error ? cause : new Error(String(cause)));
        }
      });
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const listeners = subscribers.get(url);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscribers.delete(url);
    }

    if (w) {
      w.postMessage({ type: 'unsubscribe', url } satisfies PriceWorkerInbound);
    } else if (listeners.size === 0) {
      const timer = fallbackSubscriptions.get(url);
      if (timer !== undefined) {
        clearTimeout(timer);
        fallbackSubscriptions.delete(url);
      }
    }
  };
}
