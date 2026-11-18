import { fromBase64, fromBech32, toBase64, toHex } from '@cosmjs/encoding';
import {
  QueryPoolRequest,
  QueryPoolResponse,
  QueryValidatorsRequest,
  QueryValidatorsResponse,
} from 'cosmjs-types/cosmos/staking/v1beta1/query';
import {
  QueryVotesRequest,
  QueryVotesResponse,
} from 'cosmjs-types/cosmos/gov/v1beta1/query';
import { encodeProtoPageRequest, queryAbci } from '@/libs/abci';
import { parseBigIntToken } from '@/libs/stakingConcentration';
import {
  PageRequest,
  type Coin,
  type GovProposal,
  type GovVote,
  type Tally,
  type VoteOption,
} from '@/types';

export type ExclusionPolicyMode =
  | 'airdrop_title'
  | 'ignore_ids'
  | 'both'
  | 'none';

export interface ExclusionPolicyConfig {
  mode: ExclusionPolicyMode;
  ignoredIds?: string[];
}

export function applyProposalExclusionPolicy(
  proposals: GovProposal[] | undefined,
  config: ExclusionPolicyConfig = { mode: 'airdrop_title' }
): { proposals: GovProposal[]; excludedCount: number } {
  if (!Array.isArray(proposals)) return { proposals: [], excludedCount: 0 };
  const ignoredSet = new Set((config.ignoredIds || []).map(String));
  let excludedCount = 0;

  const filtered = proposals.filter((item) => {
    const title = (item?.title || '').toLowerCase();
    const id = String(item?.proposal_id || '');
    let exclude = false;

    if (config.mode === 'airdrop_title' || config.mode === 'both') {
      if (title.includes('airdrop')) exclude = true;
    }
    if (config.mode === 'ignore_ids' || config.mode === 'both') {
      if (ignoredSet.has(id)) exclude = true;
    }

    if (exclude) excludedCount += 1;
    return !exclude;
  });

  return { proposals: filtered, excludedCount };
}

export interface NormalizedVote {
  voter: string;
  options: { option: string; weight: number; rawWeight: string }[];
  isWeighted: boolean;
  summary: string;
}

export function normalizeVoteRecord(vote: GovVote): NormalizedVote {
  const options: { option: string; weight: number; rawWeight: string }[] = [];
  if (Array.isArray(vote.options) && vote.options.length > 0) {
    for (const opt of vote.options) {
      const name = String(opt?.option || 'VOTE_OPTION_UNSPECIFIED').replace(
        'VOTE_OPTION_',
        ''
      );
      const num = Number(opt?.weight ?? 0);
      if (num > 0) {
        options.push({
          option: name,
          weight: num,
          rawWeight: String(opt.weight),
        });
      }
    }
  } else if (vote.option && vote.option !== 'VOTE_OPTION_UNSPECIFIED') {
    options.push({
      option: String(vote.option).replace('VOTE_OPTION_', ''),
      weight: 1,
      rawWeight: '1',
    });
  }

  const isWeighted =
    options.length > 1 ||
    (options.length === 1 && options[0].weight < 1);
  const summary =
    options.length > 0
      ? options
          .map((o) =>
            isWeighted ? `${o.option} (${Math.round(o.weight * 100)}%)` : o.option
          )
          .join(', ')
      : 'UNSPECIFIED';

  return {
    voter: vote.voter,
    options,
    isWeighted,
    summary,
  };
}

export function filterNormalizedVotes(
  votes: NormalizedVote[],
  selectedOption: string
): NormalizedVote[] {
  if (!selectedOption || selectedOption === 'ALL') return votes;
  const target = selectedOption.replace('VOTE_OPTION_', '');
  return votes.filter((v) =>
    v.options.some((opt) => opt.option === target && opt.weight > 0)
  );
}

export function decodeBech32Hex(address?: string): string {
  if (!address) return '';
  try {
    return toHex(fromBech32(address.trim()).data).toUpperCase();
  } catch {
    return '';
  }
}

export interface NonVoterValidator {
  operatorAddress: string;
  moniker: string;
  tokens: string;
}

export interface NonVotersResult {
  available: boolean;
  height: string;
  nonVoters: NonVoterValidator[];
  bondedCount: number;
  votedBondedCount: number;
  reason: string;
}

export async function computeActiveProposalNonVoters(
  rpcEndpoint: string,
  proposalId: string,
  height: string | number
): Promise<NonVotersResult> {
  const targetHeight = String(height || '');
  if (!rpcEndpoint || !targetHeight || Number(targetHeight) <= 0) {
    return {
      available: false,
      height: targetHeight,
      nonVoters: [],
      bondedCount: 0,
      votedBondedCount: 0,
      reason: 'RPC endpoint or consistent block height is unavailable.',
    };
  }

  try {
    // 1. Collect all bonded validators at exact height H via ABCI
    const validators: { operatorAddress: string; moniker: string; tokens: string; hex: string }[] = [];
    const seenValCursors = new Set<string>();
    let valNextKey = '';

    for (;;) {
      const page = new PageRequest();
      page.setPageSize(200);
      page.count_total = false;
      if (valNextKey) page.key = valNextKey;

      const reqBytes = QueryValidatorsRequest.encode(
        QueryValidatorsRequest.fromPartial({
          status: 'BOND_STATUS_BONDED',
          pagination: encodeProtoPageRequest(page),
        })
      ).finish();

      const abci = await queryAbci(
        rpcEndpoint,
        '/cosmos.staking.v1beta1.Query/Validators',
        reqBytes,
        targetHeight
      );
      if (abci.height && abci.height !== targetHeight) {
        throw new Error(
          `Validator query height mismatch (expected ${targetHeight}, got ${abci.height}).`
        );
      }
      const decoded = QueryValidatorsResponse.decode(abci.value);
      for (const v of decoded.validators || []) {
        const hex = decodeBech32Hex(v.operatorAddress);
        if (hex) {
          validators.push({
            operatorAddress: v.operatorAddress,
            moniker: v.description?.moniker || v.operatorAddress,
            tokens: v.tokens || '0',
            hex,
          });
        }
      }
      const nextBytes = decoded.pagination?.nextKey;
      const cursor = nextBytes && nextBytes.length > 0 ? toBase64(nextBytes) : '';
      if (!cursor) break;
      if (seenValCursors.has(cursor)) {
        throw new Error('Repeated pagination cursor in ABCI validator query.');
      }
      seenValCursors.add(cursor);
      valNextKey = cursor;
    }

    // 2. Collect all governance votes at exact same height H via ABCI
    const voterHexes = new Set<string>();
    const seenVoteCursors = new Set<string>();
    let voteNextKey = '';

    for (;;) {
      const page = new PageRequest();
      page.setPageSize(200);
      page.count_total = false;
      if (voteNextKey) page.key = voteNextKey;

      const reqBytes = QueryVotesRequest.encode(
        QueryVotesRequest.fromPartial({
          proposalId: BigInt(proposalId),
          pagination: encodeProtoPageRequest(page),
        })
      ).finish();

      const abci = await queryAbci(
        rpcEndpoint,
        '/cosmos.gov.v1beta1.Query/Votes',
        reqBytes,
        targetHeight
      );
      if (abci.height && abci.height !== targetHeight) {
        throw new Error(
          `Votes query height mismatch (expected ${targetHeight}, got ${abci.height}).`
        );
      }
      const decoded = QueryVotesResponse.decode(abci.value);
      for (const vote of decoded.votes || []) {
        const hasVote =
          Number(vote.option || 0) !== 0 ||
          (Array.isArray(vote.options) &&
            vote.options.some((o) => Number(o.weight || 0) > 0));
        if (hasVote) {
          const hex = decodeBech32Hex(vote.voter);
          if (hex) voterHexes.add(hex);
        }
      }
      const nextBytes = decoded.pagination?.nextKey;
      const cursor = nextBytes && nextBytes.length > 0 ? toBase64(nextBytes) : '';
      if (!cursor) break;
      if (seenVoteCursors.has(cursor)) {
        throw new Error('Repeated pagination cursor in ABCI votes query.');
      }
      seenVoteCursors.add(cursor);
      voteNextKey = cursor;
    }

    const nonVoters: NonVoterValidator[] = [];
    let votedBondedCount = 0;
    for (const v of validators) {
      if (voterHexes.has(v.hex)) {
        votedBondedCount += 1;
      } else {
        nonVoters.push({
          operatorAddress: v.operatorAddress,
          moniker: v.moniker,
          tokens: v.tokens,
        });
      }
    }

    return {
      available: true,
      height: targetHeight,
      nonVoters,
      bondedCount: validators.length,
      votedBondedCount,
      reason: '',
    };
  } catch (cause) {
    return {
      available: false,
      height: targetHeight,
      nonVoters: [],
      bondedCount: 0,
      votedBondedCount: 0,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

// --- Plan 26: Historical Closed Proposal Vote Reconstruction ---
export interface HistoricalTxMessage {
  type: string;
  proposalId: string;
  voter?: string;
  option?: string;
  options?: VoteOption[];
  depositor?: string;
  amount?: Coin[];
  failed?: boolean;
}

export interface HistoricalTxRecord {
  height: number;
  txIndex: number;
  txhash: string;
  code: number;
  timestamp: string;
  messages: HistoricalTxMessage[];
}

export interface HistoricalVoteEvidence {
  proposalId: string;
  startHeight: number;
  endHeight: number;
  roundStartHeight?: number;
  coveredHeights: number[];
  txs: HistoricalTxRecord[];
  indexComplete: boolean;
  indexError?: string;
}

export interface ReconstructedVotesResult {
  complete: boolean;
  votes: NormalizedVote[];
  reason: string;
}

export function reconstructClosedProposalVotes(
  evidence: HistoricalVoteEvidence
): ReconstructedVotesResult {
  if (!evidence.indexComplete || evidence.indexError) {
    return {
      complete: false,
      votes: [],
      reason:
        evidence.indexError ||
        'Transaction index completeness could not be verified.',
    };
  }
  if (
    !Number.isInteger(evidence.startHeight) ||
    !Number.isInteger(evidence.endHeight) ||
    evidence.endHeight < evidence.startHeight
  ) {
    return {
      complete: false,
      votes: [],
      reason: 'Invalid proposal block height range.',
    };
  }

  const covered = new Set(evidence.coveredHeights);
  for (let h = evidence.startHeight; h <= evidence.endHeight; h++) {
    if (!covered.has(h)) {
      return {
        complete: false,
        votes: [],
        reason: `Incomplete block coverage: missing height ${h} in [${evidence.startHeight}..${evidence.endHeight}].`,
      };
    }
  }

  const minRoundHeight = evidence.roundStartHeight ?? evidence.startHeight;
  const orderedTxs = [...evidence.txs].sort((a, b) =>
    a.height !== b.height ? a.height - b.height : a.txIndex - b.txIndex
  );

  const latestByVoter = new Map<string, NormalizedVote>();
  for (const tx of orderedTxs) {
    if (tx.code !== 0) continue;
    if (tx.height < minRoundHeight || tx.height > evidence.endHeight) continue;
    for (const msg of tx.messages) {
      if (msg.failed) continue;
      if (String(msg.proposalId) !== String(evidence.proposalId)) continue;
      if (
        msg.type !== 'MsgVote' &&
        msg.type !== 'MsgVoteWeighted'
      ) {
        continue;
      }
      if (!msg.voter) continue;

      const normalized = normalizeVoteRecord({
        proposal_id: String(evidence.proposalId),
        voter: msg.voter,
        option: msg.option || 'VOTE_OPTION_UNSPECIFIED',
        options: msg.options || [],
      });
      if (normalized.options.length > 0) {
        latestByVoter.set(msg.voter, normalized);
      }
    }
  }

  return {
    complete: true,
    votes: Array.from(latestByVoter.values()),
    reason: '',
  };
}

// --- Plan 27: Historical Closed Proposal Deposit Reconstruction ---
export interface HistoricalDepositEvent {
  depositor: string;
  amount: Coin[];
  height: number;
  txhash: string;
  timestamp: string;
  kind: 'initial_deposit' | 'deposit';
}

export interface HistoricalDepositEvidence {
  proposalId: string;
  startHeight: number;
  endHeight: number;
  coveredHeights: number[];
  txs: HistoricalTxRecord[];
  indexComplete: boolean;
  indexError?: string;
}

export interface ReconstructedDepositsResult {
  complete: boolean;
  events: HistoricalDepositEvent[];
  reason: string;
}

export function reconstructClosedProposalDeposits(
  evidence: HistoricalDepositEvidence
): ReconstructedDepositsResult {
  if (!evidence.indexComplete || evidence.indexError) {
    return {
      complete: false,
      events: [],
      reason:
        evidence.indexError ||
        'Transaction index completeness could not be verified.',
    };
  }
  if (
    !Number.isInteger(evidence.startHeight) ||
    !Number.isInteger(evidence.endHeight) ||
    evidence.endHeight < evidence.startHeight
  ) {
    return {
      complete: false,
      events: [],
      reason: 'Invalid proposal deposit height range.',
    };
  }

  const covered = new Set(evidence.coveredHeights);
  for (let h = evidence.startHeight; h <= evidence.endHeight; h++) {
    if (!covered.has(h)) {
      return {
        complete: false,
        events: [],
        reason: `Incomplete block coverage: missing height ${h} in [${evidence.startHeight}..${evidence.endHeight}].`,
      };
    }
  }

  const orderedTxs = [...evidence.txs].sort((a, b) =>
    a.height !== b.height ? a.height - b.height : a.txIndex - b.txIndex
  );

  const events: HistoricalDepositEvent[] = [];
  for (const tx of orderedTxs) {
    if (tx.code !== 0) continue;
    if (tx.height < evidence.startHeight || tx.height > evidence.endHeight) continue;
    for (const msg of tx.messages) {
      if (msg.failed) continue;
      if (String(msg.proposalId) !== String(evidence.proposalId)) continue;
      if (msg.type !== 'MsgSubmitProposal' && msg.type !== 'MsgDeposit') continue;
      if (!msg.depositor || !Array.isArray(msg.amount) || msg.amount.length === 0) continue;
      events.push({
        depositor: msg.depositor,
        amount: msg.amount,
        height: tx.height,
        txhash: tx.txhash,
        timestamp: tx.timestamp,
        kind: msg.type === 'MsgSubmitProposal' ? 'initial_deposit' : 'deposit',
      });
    }
  }

  return {
    complete: true,
    events,
    reason: '',
  };
}

// --- Plan 28: Proposal Turnout Snapshot ---
export interface TurnoutSnapshotResult {
  available: boolean;
  percent: string;
  totalVotes: bigint;
  bondedTokens: bigint;
  height: string;
  isLiveEstimate: boolean;
  reason: string;
}

export function computeProposalTurnout(
  tally: Tally | undefined,
  bondedTokensRaw: string | undefined,
  options: {
    height?: string;
    isLiveEstimate: boolean;
    snapshotUnavailableReason?: string;
  }
): TurnoutSnapshotResult {
  if (options.snapshotUnavailableReason) {
    return {
      available: false,
      percent: '-',
      totalVotes: 0n,
      bondedTokens: 0n,
      height: options.height || '',
      isLiveEstimate: options.isLiveEstimate,
      reason: options.snapshotUnavailableReason,
    };
  }

  if (!tally) {
    return {
      available: false,
      percent: '-',
      totalVotes: 0n,
      bondedTokens: 0n,
      height: options.height || '',
      isLiveEstimate: options.isLiveEstimate,
      reason: 'Proposal tally is unavailable.',
    };
  }

  const totalVotes =
    parseBigIntToken(tally.yes) +
    parseBigIntToken(tally.no) +
    parseBigIntToken(tally.no_with_veto) +
    parseBigIntToken(tally.abstain);
  const bondedTokens = parseBigIntToken(bondedTokensRaw);

  if (bondedTokens <= 0n) {
    return {
      available: false,
      percent: '-',
      totalVotes,
      bondedTokens: 0n,
      height: options.height || '',
      isLiveEstimate: options.isLiveEstimate,
      reason: 'Bonded pool denominator is zero or unavailable.',
    };
  }

  const bp = Number((totalVotes * 10000n) / bondedTokens);
  return {
    available: true,
    percent: `${(bp / 100).toFixed(2)}%`,
    totalVotes,
    bondedTokens,
    height: options.height || '',
    isLiveEstimate: options.isLiveEstimate,
    reason: '',
  };
}

export async function queryStakingPoolAtHeight(
  rpcEndpoint: string,
  height: string | number
): Promise<{ bondedTokens: string; height: string }> {
  const reqBytes = QueryPoolRequest.encode(
    QueryPoolRequest.fromPartial({})
  ).finish();
  const abci = await queryAbci(
    rpcEndpoint,
    '/cosmos.staking.v1beta1.Query/Pool',
    reqBytes,
    height
  );
  const decoded = QueryPoolResponse.decode(abci.value);
  return {
    bondedTokens: decoded.pool?.bondedTokens || '0',
    height: abci.height || String(height),
  };
}
