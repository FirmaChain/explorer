import { defineStore } from 'pinia';
import { useBlockchain } from '@/stores';
import { decodeTxRaw, type DecodedTxRaw } from '@cosmjs/proto-signing';
import dayjs from 'dayjs';
import type { Block } from '@/types';
import { hashTx } from '@/libs';
import {
  computeBackfillHeights,
  fetchBlocksBounded,
  mergeRecentBlocks,
  parseHeight,
} from '@/libs/recentBlocks';
import { fromBase64 } from '@cosmjs/encoding';

// `"false"` is a truthy string, so compare explicitly.
const FETCH_ALL_BLOCKS = import.meta.env.VITE_FETCH_ALL_BLOCKS === 'true';
const RECENT_BLOCKS_LIMIT = Number(import.meta.env.VITE_RECENT_BLOCK_LIMIT) || 50;
type Theme = 'light' | 'dark';
const DEFAULT_THEME: Theme = import.meta.env.VITE_DEFAULT_THEME === 'light' ? 'light' : 'dark';

function initialTheme(): Theme {
  const storedTheme = typeof window !== 'undefined' ? window.localStorage?.getItem('theme') : null;
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : DEFAULT_THEME;
}

export const useBaseStore = defineStore('baseStore', {
  state: () => {
    return {
      earliest: {} as Block,
      latest: {} as Block,
      recents: [] as Block[],
      missingHeights: [] as number[],
      fetchAllBlocks: FETCH_ALL_BLOCKS,
      windowLimit: RECENT_BLOCKS_LIMIT,
      pollGeneration: 0,
      contextKey: '',
      lastPollError: '',
      theme: initialTheme(),
      connected: false,
      connectionChecked: false,
    };
  },
  getters: {
    blocktime(): number {
      if (this.earliest && this.latest) {
        if (this.latest.block?.header?.height !== this.earliest.block?.header?.height) {
          const diff = dayjs(this.latest.block?.header?.time).diff(this.earliest.block?.header?.time);
          const blocks = Number(this.latest.block.header.height) - Number(this.earliest.block.header.height);
          return Math.round(diff / blocks);
        }
      }
      return 1000; // better to start low and increase
    },
    blockchain() {
      return useBlockchain();
    },
    hasRpc(): boolean {
      return this.blockchain?.rpc as unknown as boolean;
    },
    currentChainId(): string {
      return this.latest.block?.header.chain_id || '';
    },
    isContiguous(): boolean {
      return (
        this.fetchAllBlocks &&
        parseHeight(this.latest) > 0 &&
        this.recents.length > 0 &&
        this.missingHeights.length === 0 &&
        !this.lastPollError
      );
    },
    txsInRecents() {
      const txs = [] as {
        height: string;
        hash: string;
        tx: DecodedTxRaw;
      }[];
      const seen = new Set<string>();
      this.recents.forEach((b) =>
        b.block?.data?.txs.forEach((tx: string) => {
          if (tx) {
            const raw = fromBase64(tx);
            try {
              const hash = hashTx(raw);
              const height = b.block.header.height;
              const dedupKey = `${height}:${hash}`;
              if (seen.has(dedupKey)) return;
              seen.add(dedupKey);
              txs.push({
                height,
                hash,
                tx: decodeTxRaw(raw),
              });
            } catch (e) {
              console.error(e);
            }
          }
        })
      );
      return txs.sort((a, b) => {
        return Number(b.height) - Number(a.height);
      });
    },
  },
  actions: {
    async initial() {
      while (!this.hasRpc) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      this.fetchLatest();
    },
    currentContextKey(): string {
      return `${this.blockchain?.chainName || ''}|${this.blockchain?.endpoint?.address || ''}`;
    },
    resetForContext(nextKey: string) {
      this.pollGeneration += 1;
      this.contextKey = nextKey;
      this.earliest = {} as Block;
      this.latest = {} as Block;
      this.recents = [];
      this.missingHeights = [];
      this.lastPollError = '';
      this.connected = false;
      this.connectionChecked = false;
    },
    async clearRecentBlocks() {
      this.pollGeneration += 1;
      this.recents = [];
      this.missingHeights = [];
    },
    async fetchLatest() {
      if (!this.hasRpc) return this.latest;
      const nextCtx = this.currentContextKey();
      if (this.contextKey && this.contextKey !== nextCtx) {
        this.resetForContext(nextCtx);
      } else if (!this.contextKey) {
        this.contextKey = nextCtx;
      }

      const gen = this.pollGeneration;
      let latestRes: Block;
      try {
        latestRes = await this.blockchain.rpc?.getBaseBlockLatest();
        if (gen !== this.pollGeneration || this.currentContextKey() !== nextCtx) {
          return this.latest;
        }
        const header = latestRes?.block?.header;
        if (!header?.height || !header?.chain_id || parseHeight(latestRes) <= 0) {
          throw new Error('malformed blocks/latest payload');
        }
        const prevChainId = this.latest?.block?.header?.chain_id;
        const prevHeight = parseHeight(this.latest);
        const nextHeight = parseHeight(latestRes);
        if (prevChainId && prevChainId === header.chain_id && nextHeight < prevHeight) {
          // Ignore stale/out-of-order overlapping poll response
          return this.latest;
        }
        this.latest = latestRes;
        this.connected = true;
        this.connectionChecked = true;
        this.lastPollError = '';
      } catch (error) {
        if (gen !== this.pollGeneration || this.currentContextKey() !== nextCtx) {
          return this.latest;
        }
        console.error('Error fetching latest block:', error);
        this.connected = false;
        this.connectionChecked = true;
        this.lastPollError =
          error instanceof Error ? error.message : String(error);
        return this.latest;
      }

      if (
        !this.earliest?.block?.header?.chain_id ||
        this.earliest?.block?.header?.chain_id !== this.latest?.block?.header?.chain_id
      ) {
        this.earliest = this.latest;
        this.recents = [];
        this.missingHeights = [];
      }

      const latestHeight = parseHeight(this.latest);
      const chainId = this.latest.block.header.chain_id;

      if (!this.fetchAllBlocks) {
        if (
          this.recents.findIndex(
            (x) => x?.block_id?.hash === this.latest?.block_id?.hash
          ) === -1
        ) {
          const combined = [...this.recents, this.latest];
          this.recents = combined.slice(-this.windowLimit);
        }
        return this.latest;
      }

      const newBlocks = await this.fetchNewBlocks(gen, nextCtx);
      if (gen !== this.pollGeneration || this.currentContextKey() !== nextCtx) {
        return this.latest;
      }
      const merged = mergeRecentBlocks(
        this.recents,
        [...newBlocks, this.latest],
        this.windowLimit,
        latestHeight,
        chainId
      );
      if (merged.conflicts.length > 0) {
        this.lastPollError = `Block hash or chain conflict at height(s): ${merged.conflicts.join(', ')}`;
      }
      this.recents = merged.blocks;
      this.missingHeights = merged.missingHeights;
      return this.latest;
    },
    async fetchNewBlocks(expectedGen?: number, expectedCtx?: string) {
      const gen = expectedGen ?? this.pollGeneration;
      const ctx = expectedCtx ?? this.currentContextKey();
      const latestHeight = parseHeight(this.latest);
      if (!latestHeight) return [];
      if (!this.fetchAllBlocks) return [this.latest];

      const chainId = this.latest.block.header.chain_id;
      const toFetch = computeBackfillHeights(
        latestHeight,
        this.windowLimit,
        this.recents,
        this.missingHeights
      );
      if (!toFetch.length) return [];

      const { blocks } = await fetchBlocksBounded(
        toFetch,
        (h) => this.blockchain.rpc.getBaseBlockAt(String(h)),
        chainId,
        {
          concurrency: 4,
          timeoutMs: 8000,
          isCancelled: () =>
            gen !== this.pollGeneration ||
            this.currentContextKey() !== ctx,
        }
      );
      return blocks;
    },
    async fetchValidatorByHeight(height?: number, offset = 0) {
      return this.blockchain.rpc.getBaseValidatorsetAt(String(height), offset);
    },
    async fetchLatestValidators(offset = 0) {
      return this.blockchain.rpc.getBaseValidatorsetLatest(offset);
    },
    async fetchBlock(height?: number | string) {
      try {
        const block = await this.blockchain.rpc.getBaseBlockAt(String(height));
        this.connected = true;
        this.connectionChecked = true;
        return block;
      } catch (error) {
        console.error('Error fetching latest block:', error);
        this.connected = false;
        this.connectionChecked = true;
      }
      return {} as Block;
    },
    async fetchAbciInfo() {
      return this.blockchain.rpc.getBaseNodeInfo();
    },
    // async fetchNodeInfo() {
    //     return this.blockchain.rpc.no()
    // }
  },
});
