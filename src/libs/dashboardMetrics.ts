import fetch from 'cross-fetch';
import { normalizeConsensusHex } from '@/libs/address';
import {
  buildBlockSignatures,
  fetchValidatorSetAtHeight,
} from '@/libs/blockSignatures';
import {
  consensusHexOfTendermintValidator,
  parseBigIntToken,
} from '@/libs/stakingConcentration';
import type { Block, TendermintValidator, Validator } from '@/types';

export interface ConsensusSnapshot {
  available: boolean;
  height: string;
  round: string;
  step: string;
  proposerHex: string;
  proposerMoniker: string;
  error: string;
}

export function parseHeightRoundStep(raw?: string): {
  height: string;
  round: string;
  step: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { height: '', round: '', step: '' };
  }
  const [height = '', round = '', step = ''] = raw.split('/');
  return { height, round, step };
}

export async function fetchConsensusSnapshot(
  rpcEndpoint: string,
  validators: Validator[],
  signal?: AbortSignal
): Promise<ConsensusSnapshot> {
  const base = rpcEndpoint.trim().replace(/\/+$/, '');
  if (!base) {
    return {
      available: false,
      height: '',
      round: '',
      step: '',
      proposerHex: '',
      proposerMoniker: '',
      error: 'No RPC endpoint is configured for this chain.',
    };
  }

  const response = await fetch(`${base}/consensus_state`, { signal });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}, ${response.statusText}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(
      payload.error?.message || payload.error?.data || 'RPC error'
    );
  }
  const roundState = payload?.result?.round_state;
  if (!roundState || typeof roundState !== 'object') {
    throw new Error('Malformed consensus_state payload.');
  }
  const hrs = parseHeightRoundStep(roundState['height/round/step']);
  if (!hrs.height) {
    throw new Error('Missing height/round/step in consensus_state.');
  }

  const proposerRaw =
    roundState.proposer?.address ||
    roundState.validators?.proposer?.address ||
    '';
  const proposerHex = normalizeConsensusHex(proposerRaw);
  const matched = proposerHex
    ? validators.find((v) => {
        const key = v.consensus_pubkey;
        if (!key) return false;
        // Compare against normalized consensus address when available
        return (
          normalizeConsensusHex((v as any).consensus_hex) === proposerHex
        );
      })
    : undefined;

  return {
    available: true,
    height: hrs.height,
    round: hrs.round,
    step: hrs.step,
    proposerHex,
    proposerMoniker: matched?.description?.moniker || '',
    error: '',
  };
}

export interface OnlineVotingPowerResult {
  available: boolean;
  height: string;
  signedPower: bigint;
  totalPower: bigint;
  signedPercent: string;
  signedValidators: number;
  totalValidators: number;
  reason: string;
}

export const VALIDATOR_SET_CACHE_TTL_MS = 60_000;

export interface CachedValidatorSet {
  validators: TendermintValidator[];
  hexSet: Set<string>;
  fetchedAt: number;
}

export function createCachedValidatorSet(
  validators: TendermintValidator[],
  fetchedAt: number
): CachedValidatorSet {
  const hexSet = new Set<string>();
  for (const tv of validators) {
    const hex = consensusHexOfTendermintValidator(tv);
    if (hex) hexSet.add(hex);
  }
  return { validators, hexSet, fetchedAt };
}

export function canReuseCachedValidatorSet(
  cached: CachedValidatorSet | null | undefined,
  latestBlock: Block | undefined,
  nowMs: number,
  ttlMs = VALIDATOR_SET_CACHE_TTL_MS
): boolean {
  if (!cached || !cached.validators.length) return false;
  if (nowMs - cached.fetchedAt >= ttlMs) return false;

  const sigs = latestBlock?.block?.last_commit?.signatures;
  if (!Array.isArray(sigs) || sigs.length !== cached.validators.length) {
    return false;
  }

  for (const sig of sigs) {
    if (!sig?.validator_address) continue;
    const hex = normalizeConsensusHex(sig.validator_address);
    if (!hex || !cached.hexSet.has(hex)) {
      return false;
    }
  }
  return true;
}

function buildOnlineVotingPowerResult(
  commitHeight: number,
  latestBlock: Block,
  validators: TendermintValidator[],
  stakingValidators: Validator[],
  complete: boolean
): OnlineVotingPowerResult {
  const summary = buildBlockSignatures(
    commitHeight,
    latestBlock,
    validators,
    stakingValidators,
    complete
  );

  if (!summary.powerAvailable || summary.totalPower <= 0n) {
    return {
      available: false,
      height: String(commitHeight),
      signedPower: 0n,
      totalPower: summary.totalPower,
      signedPercent: '-',
      signedValidators: summary.signedCount,
      totalValidators: validators.length,
      reason: 'Could not verify complete consensus voting power at commit height.',
    };
  }

  const bp = Number((summary.signedPower * 10000n) / summary.totalPower);
  return {
    available: true,
    height: String(commitHeight),
    signedPower: summary.signedPower,
    totalPower: summary.totalPower,
    signedPercent: `${(bp / 100).toFixed(2)}%`,
    signedValidators: summary.signedCount,
    totalValidators: validators.length,
    reason: '',
  };
}

export async function computeOnlineVotingPower(
  rpc: {
    getBaseValidatorsetAt: (
      height: string | number,
      offset: number,
      page?: any
    ) => Promise<any>;
  },
  latestBlock: Block | undefined,
  stakingValidators: Validator[],
  options?: {
    cache?: { current: CachedValidatorSet | null };
    ttlMs?: number;
    now?: () => number;
  }
): Promise<OnlineVotingPowerResult> {
  const commitHeightStr = latestBlock?.block?.last_commit?.height;
  const commitHeight = Number(commitHeightStr || 0);
  if (!Number.isInteger(commitHeight) || commitHeight <= 0) {
    return {
      available: false,
      height: '',
      signedPower: 0n,
      totalPower: 0n,
      signedPercent: '-',
      signedValidators: 0,
      totalValidators: 0,
      reason: 'Latest block commit height is unavailable.',
    };
  }

  const nowFn = options?.now ?? (() => Date.now());
  const ttlMs = options?.ttlMs ?? VALIDATOR_SET_CACHE_TTL_MS;

  if (
    options?.cache &&
    canReuseCachedValidatorSet(options.cache.current, latestBlock, nowFn(), ttlMs)
  ) {
    const cachedResult = buildOnlineVotingPowerResult(
      commitHeight,
      latestBlock!,
      options.cache.current!.validators,
      stakingValidators,
      true
    );
    if (cachedResult.available) {
      return cachedResult;
    }
  }

  const valSet = await fetchValidatorSetAtHeight(rpc, commitHeight);
  if (!valSet.complete) {
    return {
      available: false,
      height: String(commitHeight),
      signedPower: 0n,
      totalPower: 0n,
      signedPercent: '-',
      signedValidators: 0,
      totalValidators: valSet.validators.length,
      reason: valSet.error || 'Consensus validator set is incomplete.',
    };
  }

  const result = buildOnlineVotingPowerResult(
    commitHeight,
    latestBlock!,
    valSet.validators,
    stakingValidators,
    valSet.complete
  );
  if (options?.cache && result.available) {
    options.cache.current = createCachedValidatorSet(valSet.validators, nowFn());
  }
  return result;
}

export interface TokenDistributionResult {
  available: boolean;
  denom: string;
  totalSupply: bigint;
  bonded: bigint;
  notBonded: bigint;
  remaining: bigint;
  bondedPercent: string;
  notBondedPercent: string;
  remainingPercent: string;
  reason: string;
}

function formatBigIntPercent(part: bigint, total: bigint): string {
  if (total <= 0n) return '0.00%';
  const bp = Number((part * 10000n) / total);
  return `${(bp / 100).toFixed(2)}%`;
}

export function computeTokenDistribution(
  denom: string,
  totalSupplyRaw?: string | number | bigint,
  bondedRaw?: string | number | bigint,
  notBondedRaw?: string | number | bigint
): TokenDistributionResult {
  if (!denom) {
    return {
      available: false,
      denom: '',
      totalSupply: 0n,
      bonded: 0n,
      notBonded: 0n,
      remaining: 0n,
      bondedPercent: '-',
      notBondedPercent: '-',
      remainingPercent: '-',
      reason: 'Bond denom is unavailable.',
    };
  }

  const totalStr = String(totalSupplyRaw ?? '').trim();
  const bondedStr = String(bondedRaw ?? '').trim();
  const notBondedStr = String(notBondedRaw ?? '').trim();

  if (!/^\d+$/.test(totalStr) || !/^\d+$/.test(bondedStr) || !/^\d+$/.test(notBondedStr)) {
    return {
      available: false,
      denom,
      totalSupply: 0n,
      bonded: 0n,
      notBonded: 0n,
      remaining: 0n,
      bondedPercent: '-',
      notBondedPercent: '-',
      remainingPercent: '-',
      reason: 'Supply or staking pool amounts are missing or non-integer.',
    };
  }

  const totalSupply = parseBigIntToken(totalStr);
  const bonded = parseBigIntToken(bondedStr);
  const notBonded = parseBigIntToken(notBondedStr);

  if (totalSupply <= 0n) {
    return {
      available: false,
      denom,
      totalSupply,
      bonded,
      notBonded,
      remaining: 0n,
      bondedPercent: '-',
      notBondedPercent: '-',
      remainingPercent: '-',
      reason: 'Total supply is zero.',
    };
  }

  const remaining = totalSupply - bonded - notBonded;
  if (remaining < 0n) {
    return {
      available: false,
      denom,
      totalSupply,
      bonded,
      notBonded,
      remaining,
      bondedPercent: '-',
      notBondedPercent: '-',
      remainingPercent: '-',
      reason: 'Pool bonded + not_bonded exceeds total supply (snapshot mismatch).',
    };
  }

  return {
    available: true,
    denom,
    totalSupply,
    bonded,
    notBonded,
    remaining,
    bondedPercent: formatBigIntPercent(bonded, totalSupply),
    notBondedPercent: formatBigIntPercent(notBonded, totalSupply),
    remainingPercent: formatBigIntPercent(remaining, totalSupply),
    reason: '',
  };
}

export function selectRecentDashboardBlocks(
  recents: Block[] | undefined,
  currentChainId: string,
  limit = 7
): Block[] {
  if (!Array.isArray(recents) || recents.length === 0) return [];
  const seen = new Set<string>();
  const valid: Block[] = [];
  for (const b of recents) {
    const h = b?.block?.header?.height;
    const cid = b?.block?.header?.chain_id;
    if (!h) continue;
    if (currentChainId && cid && cid !== currentChainId) continue;
    const key = String(h);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(b);
  }
  valid.sort(
    (a, b) => Number(b.block.header.height) - Number(a.block.header.height)
  );
  return valid.slice(0, limit);
}
