import { consensusPubkeyToHexAddress, normalizeConsensusHex } from '@/libs/address';
import {
  consensusHexOfTendermintValidator,
  parseBigIntToken,
} from '@/libs/stakingConcentration';
import {
  PageRequest,
  type Block,
  type Signature,
  type TendermintValidator,
  type Validator,
} from '@/types';

export type SignatureStatus = 'Signed' | 'Nil' | 'Absent' | 'Unknown';

export interface BlockSignatureRow {
  key: string;
  consensusHex: string;
  moniker: string;
  operatorAddress: string;
  status: SignatureStatus;
  votingPower: string;
  timestamp: string;
}

export interface BlockSignaturesSummary {
  targetHeight: string;
  commitBlockHeight: string;
  rows: BlockSignatureRow[];
  signedCount: number;
  nilCount: number;
  absentCount: number;
  signedPower: bigint;
  totalPower: bigint;
  powerAvailable: boolean;
}

export function normalizeBlockIdFlag(flag?: string | number): SignatureStatus {
  if (flag === 'BLOCK_ID_FLAG_COMMIT' || flag === 2 || flag === '2') {
    return 'Signed';
  }
  if (flag === 'BLOCK_ID_FLAG_NIL' || flag === 3 || flag === '3') {
    return 'Nil';
  }
  if (flag === 'BLOCK_ID_FLAG_ABSENT' || flag === 1 || flag === '1') {
    return 'Absent';
  }
  return 'Unknown';
}

export async function fetchValidatorSetAtHeight(
  rpc: {
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
  height: number,
  pageSize = 100
): Promise<{ validators: TendermintValidator[]; complete: boolean; error: string }> {
  const seenCursors = new Set<string>();
  const validators: TendermintValidator[] = [];
  const seenHex = new Set<string>();
  let nextKey = '';
  let offset = 0;

  try {
    for (;;) {
      const page = new PageRequest();
      page.setPageSize(pageSize);
      page.count_total = true;
      if (nextKey) {
        page.key = nextKey;
      } else if (offset > 0) {
        page.offset = offset;
      }

      const res = await rpc.getBaseValidatorsetAt(String(height), offset, page);
      if (res?.block_height && String(res.block_height) !== String(height)) {
        return {
          validators,
          complete: false,
          error: `Validator set height mismatch (expected ${height}, got ${res.block_height}).`,
        };
      }

      const batch = Array.isArray(res?.validators) ? res.validators : [];
      for (const v of batch) {
        const hex = consensusHexOfTendermintValidator(v);
        if (hex && !seenHex.has(hex)) {
          seenHex.add(hex);
          validators.push(v);
        }
      }

      const cursor = res?.pagination?.next_key || '';
      const total = Number(res?.pagination?.total || 0);
      offset += batch.length;

      if (cursor) {
        if (seenCursors.has(cursor)) {
          return {
            validators,
            complete: false,
            error: 'Repeated pagination cursor in validator set.',
          };
        }
        seenCursors.add(cursor);
        nextKey = cursor;
        continue;
      }

      if (total > 0 && validators.length < total && batch.length > 0) {
        nextKey = '';
        continue;
      }

      return { validators, complete: true, error: '' };
    }
  } catch (cause) {
    return {
      validators,
      complete: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function buildBlockSignatures(
  targetHeight: number,
  nextBlock: Block,
  consensusValidators: TendermintValidator[],
  stakingValidators: Validator[],
  validatorSetComplete: boolean
): BlockSignaturesSummary {
  const commit = nextBlock?.block?.last_commit;
  const commitHeight = commit?.height ? String(commit.height) : '';
  if (commitHeight && commitHeight !== String(targetHeight)) {
    throw new Error(
      `Commit height mismatch: block #${targetHeight + 1} last_commit is for height ${commitHeight}, expected ${targetHeight}.`
    );
  }

  const stakingByHex = new Map<string, Validator>();
  for (const sv of stakingValidators || []) {
    const hex = normalizeConsensusHex(
      consensusPubkeyToHexAddress(sv.consensus_pubkey)
    );
    if (hex) stakingByHex.set(hex, sv);
  }

  const tmByHex = new Map<string, TendermintValidator>();
  let totalPower = 0n;
  for (const tv of consensusValidators) {
    const hex = consensusHexOfTendermintValidator(tv);
    if (hex) tmByHex.set(hex, tv);
    totalPower += parseBigIntToken(tv.voting_power);
  }

  const signatures: Signature[] = Array.isArray(commit?.signatures)
    ? commit.signatures
    : [];
  const canMatchByIndex =
    validatorSetComplete &&
    consensusValidators.length === signatures.length &&
    signatures.length > 0;

  let signedCount = 0;
  let nilCount = 0;
  let absentCount = 0;
  let signedPower = 0n;
  let allMatched = validatorSetComplete && totalPower > 0n;

  const rows: BlockSignatureRow[] = signatures.map((sig, idx) => {
    const status = normalizeBlockIdFlag(sig?.block_id_flag);
    if (status === 'Signed') signedCount += 1;
    else if (status === 'Nil') nilCount += 1;
    else if (status === 'Absent') absentCount += 1;

    let hex = normalizeConsensusHex(sig?.validator_address);
    let tmVal = hex ? tmByHex.get(hex) : undefined;
    if (!tmVal && !hex && canMatchByIndex) {
      tmVal = consensusValidators[idx];
      hex = consensusHexOfTendermintValidator(tmVal);
    }
    if (!tmVal) {
      allMatched = false;
    }

    const stakingVal = hex ? stakingByHex.get(hex) : undefined;
    const power = tmVal ? parseBigIntToken(tmVal.voting_power) : 0n;
    if (status === 'Signed' && tmVal) {
      signedPower += power;
    }

    return {
      key: `${idx}-${hex || 'unknown'}`,
      consensusHex: hex,
      moniker: stakingVal?.description?.moniker || '',
      operatorAddress: stakingVal?.operator_address || '',
      status,
      votingPower: tmVal ? String(tmVal.voting_power) : '',
      timestamp: sig?.timestamp || '',
    };
  });

  return {
    targetHeight: String(targetHeight),
    commitBlockHeight: String(targetHeight + 1),
    rows,
    signedCount,
    nilCount,
    absentCount,
    signedPower,
    totalPower,
    powerAvailable: allMatched && totalPower > 0n,
  };
}
