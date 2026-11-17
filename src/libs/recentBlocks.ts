import type { Block } from '@/types';

export function parseHeight(block?: Block): number {
  const raw = block?.block?.header?.height;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function computeWindowStart(
  latestHeight: number,
  windowSize: number
): number {
  if (latestHeight <= 0 || windowSize <= 0) return 1;
  return Math.max(1, latestHeight - windowSize + 1);
}

export function computeBackfillHeights(
  latestHeight: number,
  windowSize: number,
  cachedBlocks: Block[],
  existingGaps: number[] = []
): number[] {
  if (latestHeight <= 0 || windowSize <= 1) return [];
  const start = computeWindowStart(latestHeight, windowSize);
  const cached = new Set<number>();
  for (const b of cachedBlocks) {
    const h = parseHeight(b);
    if (h >= start && h <= latestHeight) {
      cached.add(h);
    }
  }
  const needed = new Set<number>();
  for (const g of existingGaps) {
    if (g >= start && g < latestHeight && !cached.has(g)) {
      needed.add(g);
    }
  }
  for (let h = start; h < latestHeight; h++) {
    if (!cached.has(h)) {
      needed.add(h);
    }
  }
  return Array.from(needed)
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, windowSize - 1));
}

export async function fetchBlocksBounded(
  heights: number[],
  fetchOne: (height: number) => Promise<Block>,
  expectedChainId: string,
  options: { concurrency?: number; timeoutMs?: number; isCancelled?: () => boolean } = {}
): Promise<{ blocks: Block[]; failedHeights: number[] }> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const timeoutMs = Math.max(100, options.timeoutMs ?? 8000);
  const queue = [...heights];
  const blocks: Block[] = [];
  const failedHeights: number[] = [];

  async function worker() {
    while (queue.length > 0) {
      if (options.isCancelled?.()) return;
      const h = queue.shift()!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const block = await Promise.race([
          fetchOne(h),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Timeout fetching block ${h}`)),
              timeoutMs
            );
          }),
        ]);
        if (options.isCancelled?.()) return;
        const actualHeight = parseHeight(block);
        const actualChainId = block?.block?.header?.chain_id || '';
        if (
          actualHeight !== h ||
          !actualChainId ||
          (expectedChainId && actualChainId !== expectedChainId)
        ) {
          failedHeights.push(h);
          continue;
        }
        blocks.push(block);
      } catch {
        if (!options.isCancelled?.()) {
          failedHeights.push(h);
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  const workerCount = Math.min(concurrency, queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { blocks, failedHeights };
}

export function mergeRecentBlocks(
  existing: Block[],
  incoming: Block[],
  windowSize: number,
  latestHeight: number,
  expectedChainId: string
): { blocks: Block[]; missingHeights: number[]; conflicts: number[] } {
  const start = computeWindowStart(latestHeight, windowSize);
  const byHeight = new Map<number, Block>();
  const conflicts: number[] = [];

  for (const b of existing) {
    const h = parseHeight(b);
    const cid = b?.block?.header?.chain_id || '';
    if (h >= start && h <= latestHeight && (!expectedChainId || cid === expectedChainId)) {
      byHeight.set(h, b);
    }
  }

  for (const b of incoming) {
    const h = parseHeight(b);
    const cid = b?.block?.header?.chain_id || '';
    if (h < start || h > latestHeight) continue;
    if (expectedChainId && cid !== expectedChainId) {
      conflicts.push(h);
      continue;
    }
    const prev = byHeight.get(h);
    const prevHash = prev?.block_id?.hash || '';
    const nextHash = b?.block_id?.hash || '';
    if (prev && prevHash && nextHash && prevHash !== nextHash) {
      conflicts.push(h);
      byHeight.delete(h);
      continue;
    }
    byHeight.set(h, b);
  }

  const blocks = Array.from(byHeight.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => block)
    .slice(-windowSize);

  const missingHeights: number[] = [];
  if (latestHeight > 0) {
    for (let h = start; h <= latestHeight; h++) {
      if (!byHeight.has(h)) {
        missingHeights.push(h);
      }
    }
  }

  return { blocks, missingHeights, conflicts };
}
