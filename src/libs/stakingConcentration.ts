import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs/address';
import { PageRequest, type TendermintValidator, type Validator } from '@/types';

export type ValidatorSortKey =
  | 'voting_power'
  | 'moniker'
  | 'commission'
  | 'changes_24h';
export type SortDirection = 'asc' | 'desc';

export interface ValidatorFetchResult {
  validators: Validator[];
  complete: boolean;
  error: string;
}

export interface ConsensusSetResult {
  validators: TendermintValidator[];
  height: string;
  complete: boolean;
  error: string;
}

export interface ConcentrationResult {
  available: boolean;
  height: string;
  totalVotingPower: bigint;
  thresholdCount: number;
  boundaryHexes: Set<string>;
  reason: string;
}

export function parseBigIntToken(value?: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    return BigInt(Math.trunc(value));
  }
  const str = String(value ?? '').trim();
  if (!/^-?\d+$/.test(str)) return 0n;
  try {
    return BigInt(str);
  } catch {
    return 0n;
  }
}

export async function fetchAllStakingValidators(
  rpc: {
    getStakingValidatorsPage?: (
      status: string,
      page?: PageRequest
    ) => Promise<{ validators?: Validator[]; pagination?: { next_key?: string } }>;
    getStakingValidators?: (
      status: string,
      limit?: number
    ) => Promise<{ validators?: Validator[]; pagination?: { next_key?: string } }>;
  },
  status: string,
  pageSize = 200
): Promise<ValidatorFetchResult> {
  const seenCursors = new Set<string>();
  const byAddr = new Map<string, Validator>();
  let nextKey = '';

  try {
    for (;;) {
      const page = new PageRequest();
      page.setPageSize(pageSize);
      page.count_total = false;
      if (nextKey) page.key = nextKey;

      const res = rpc.getStakingValidatorsPage
        ? await rpc.getStakingValidatorsPage(status, page)
        : await rpc.getStakingValidators?.(status, pageSize);

      const batch = Array.isArray(res?.validators) ? res!.validators : [];
      for (const v of batch) {
        if (v?.operator_address && !byAddr.has(v.operator_address)) {
          byAddr.set(v.operator_address, v);
        }
      }

      const cursor = res?.pagination?.next_key || '';
      if (!cursor) {
        return {
          validators: Array.from(byAddr.values()),
          complete: true,
          error: '',
        };
      }
      if (!rpc.getStakingValidatorsPage) {
        return {
          validators: Array.from(byAddr.values()),
          complete: false,
          error: 'Paginated validator endpoint is unavailable on this client.',
        };
      }
      if (seenCursors.has(cursor)) {
        return {
          validators: Array.from(byAddr.values()),
          complete: false,
          error: 'Repeated pagination cursor while loading validators.',
        };
      }
      seenCursors.add(cursor);
      nextKey = cursor;
    }
  } catch (cause) {
    return {
      validators: Array.from(byAddr.values()),
      complete: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function consensusHexOfTendermintValidator(
  v?: TendermintValidator
): string {
  if (!v) return '';
  return (
    normalizeConsensusHex(v.address) ||
    normalizeConsensusHex(consensusPubkeyToHexAddress(v.pub_key))
  );
}

export async function fetchCompleteConsensusValidatorSet(
  rpc: {
    getBaseValidatorsetLatest: (
      offset: number,
      page?: PageRequest
    ) => Promise<{
      validators?: TendermintValidator[];
      block_height?: string;
      pagination?: { next_key?: string; total?: string };
    }>;
    getBaseValidatorsetAt: (
      height: string | number,
      offset: number,
      page?: PageRequest
    ) => Promise<{
      validators?: TendermintValidator[];
      block_height?: string;
      pagination?: { next_key?: string; total?: string };
    }>;
  },
  pageSize = 100
): Promise<ConsensusSetResult> {
  const seenCursors = new Set<string>();
  const byHex = new Map<string, TendermintValidator>();

  try {
    const firstPage = new PageRequest();
    firstPage.setPageSize(pageSize);
    firstPage.count_total = true;

    const first = await rpc.getBaseValidatorsetLatest(0, firstPage);
    const height = first?.block_height ? String(first.block_height) : '';
    if (!height) {
      return {
        validators: [],
        height: '',
        complete: false,
        error: 'Validator set response did not include block_height.',
      };
    }

    const firstList = Array.isArray(first?.validators) ? first.validators : [];
    for (const v of firstList) {
      const hex = consensusHexOfTendermintValidator(v);
      if (hex && !byHex.has(hex)) byHex.set(hex, v);
    }

    let nextKey = first?.pagination?.next_key || '';
    let total = Number(first?.pagination?.total || 0);
    let offset = firstList.length;

    while (nextKey || (total > 0 && byHex.size < total && offset > 0)) {
      const page = new PageRequest();
      page.setPageSize(pageSize);
      page.count_total = false;
      if (nextKey) {
        if (seenCursors.has(nextKey)) {
          return {
            validators: Array.from(byHex.values()),
            height,
            complete: false,
            error: 'Repeated pagination cursor in consensus validator set.',
          };
        }
        seenCursors.add(nextKey);
        page.key = nextKey;
      } else {
        page.offset = offset;
      }

      const res = await rpc.getBaseValidatorsetAt(height, offset, page);
      const resHeight = res?.block_height ? String(res.block_height) : '';
      if (resHeight && resHeight !== height) {
        return {
          validators: Array.from(byHex.values()),
          height,
          complete: false,
          error: `Validator set height mismatch (expected ${height}, got ${resHeight}).`,
        };
      }

      const batch = Array.isArray(res?.validators) ? res.validators : [];
      if (!batch.length && !res?.pagination?.next_key) break;

      let added = 0;
      for (const v of batch) {
        const hex = consensusHexOfTendermintValidator(v);
        if (hex && !byHex.has(hex)) {
          byHex.set(hex, v);
          added += 1;
        }
      }
      offset += batch.length;
      nextKey = res?.pagination?.next_key || '';
      if (!nextKey && added === 0) break;
    }

    return {
      validators: Array.from(byHex.values()),
      height,
      complete: true,
      error: '',
    };
  } catch (cause) {
    return {
      validators: Array.from(byHex.values()),
      height: '',
      complete: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function computeValidatorConcentration(
  consensusValidators: TendermintValidator[],
  height: string,
  complete = true,
  error = ''
): ConcentrationResult {
  if (!complete || error) {
    return {
      available: false,
      height,
      totalVotingPower: 0n,
      thresholdCount: 0,
      boundaryHexes: new Set(),
      reason: error || 'Consensus validator set is incomplete.',
    };
  }

  const entries = consensusValidators
    .map((v) => ({
      hex: consensusHexOfTendermintValidator(v),
      power: parseBigIntToken(v.voting_power),
    }))
    .filter((item) => item.hex && item.power > 0n);

  const totalVotingPower = entries.reduce((acc, item) => acc + item.power, 0n);
  if (totalVotingPower <= 0n || entries.length === 0) {
    return {
      available: false,
      height,
      totalVotingPower: 0n,
      thresholdCount: 0,
      boundaryHexes: new Set(),
      reason: 'Total active consensus voting power is zero.',
    };
  }

  entries.sort((a, b) => {
    if (a.power !== b.power) return b.power > a.power ? 1 : -1;
    return a.hex.localeCompare(b.hex);
  });

  const target = totalVotingPower * 34n;
  const boundaryHexes = new Set<string>();
  let cumulative = 0n;
  let crossingPower: bigint | null = null;

  for (const item of entries) {
    if (cumulative * 100n < target) {
      boundaryHexes.add(item.hex);
      cumulative += item.power;
      if (cumulative * 100n >= target && crossingPower === null) {
        crossingPower = item.power;
      }
    } else if (crossingPower !== null && item.power === crossingPower) {
      boundaryHexes.add(item.hex);
    } else {
      break;
    }
  }

  return {
    available: true,
    height,
    totalVotingPower,
    thresholdCount: boundaryHexes.size,
    boundaryHexes,
    reason: '',
  };
}

export function filterAndSortValidators<
  T extends { v: Validator; change24?: number }
>(
  items: T[],
  query: string,
  sortKey: ValidatorSortKey,
  sortDir: SortDirection
): T[] {
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? items.filter((item) => {
        const moniker = (item.v.description?.moniker || '').toLowerCase();
        const addr = (item.v.operator_address || '').toLowerCase();
        return moniker.includes(normalized) || addr.includes(normalized);
      })
    : [...items];

  const dir = sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'voting_power') {
      const pa = parseBigIntToken(a.v.tokens);
      const pb = parseBigIntToken(b.v.tokens);
      cmp = pa === pb ? 0 : pa > pb ? 1 : -1;
    } else if (sortKey === 'moniker') {
      const ma = (a.v.description?.moniker || '').trim().toLowerCase();
      const mb = (b.v.description?.moniker || '').trim().toLowerCase();
      cmp = ma.localeCompare(mb);
    } else if (sortKey === 'commission') {
      const ca = Number(a.v.commission?.commission_rates?.rate || 0);
      const cb = Number(b.v.commission?.commission_rates?.rate || 0);
      cmp = ca === cb ? 0 : ca > cb ? 1 : -1;
    } else if (sortKey === 'changes_24h') {
      const da = Number(a.change24 || 0);
      const db = Number(b.change24 || 0);
      cmp = da === db ? 0 : da > db ? 1 : -1;
    }

    if (cmp !== 0) return cmp * dir;
    return (a.v.operator_address || '').localeCompare(
      b.v.operator_address || ''
    );
  });

  return filtered;
}
