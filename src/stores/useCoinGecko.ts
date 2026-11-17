import { defineStore } from 'pinia';
import { fetchPriceCached, subscribePrice } from '@/libs/priceWorkerClient';
import type { LoadingStatus } from '@/stores';

export interface PriceMeta {
  usd?: string;
  usd_24h_change?: string;
  cny?: string;
  cny_24h_change?: string;
  eur?: string;
  eur_24h_change?: string;
}

const LocalStoreKey = 'currency';

export const coingeckoUrl = import.meta.env.VITE_COINGECKO_URL || 'https://api.coingecko.com';

let unsubscribeCoinPrice: (() => void) | null = null;

function marketChartUrl(days = 30, coinId = 'cosmos') {
  return `${coingeckoUrl}/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
}

function coinInfoUrl(coinId: string) {
  return `${coingeckoUrl}/api/v3/coins/${coinId}`;
}

export const useCoingecko = defineStore('coingecko', {
  state: () => {
    const currency = localStorage.getItem(LocalStoreKey);
    return {
      currency, // secondary currency
      loadStatus: {} as Record<string, LoadingStatus | undefined>,
      prices: {} as Record<string, PriceMeta>,
      marketChart: {},
    };
  },
  getters: {},

  actions: {
    getMarketChart(days = 30, coinId = 'cosmos') {
      return fetchPriceCached(marketChartUrl(days, coinId));
    },

    subscribeMarketChart(days = 30, coinId = 'cosmos', onData: (data: any) => void) {
      return subscribePrice(marketChartUrl(days, coinId), onData);
    },

    fetchCoinPrice(ids: string[]) {
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const currencies = this.currency ? ['usd', this.currency] : ['usd'];
      const url = `${coingeckoUrl}/api/v3/simple/price?include_24hr_change=true&vs_currencies=${currencies.join(
        ','
      )}&ids=${uniqueIds.join(',')}`;
      unsubscribeCoinPrice?.();
      unsubscribeCoinPrice = subscribePrice(url, (data) => {
        this.prices = { ...this.prices, ...data };
      });
    },
    getCoinInfo(coinId: string) {
      return fetchPriceCached(coinInfoUrl(coinId));
    },
    subscribeCoinInfo(coinId: string, onData: (data: any) => void) {
      return subscribePrice(coinInfoUrl(coinId), onData);
    },
    setSecondaryCurrency(currency: string) {
      if (currency !== 'usd') {
        localStorage.setItem(LocalStoreKey, currency);
        this.currency = currency;
      }
    },
  },
});
