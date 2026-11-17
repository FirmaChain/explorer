import fetch from 'cross-fetch';
import { fromBase64, toBase64, toHex } from '@cosmjs/encoding';
import {
  QueryRedelegationsRequest,
  QueryRedelegationsResponse,
} from 'cosmjs-types/cosmos/staking/v1beta1/query';
import type { ChainConfig } from '@/types/chaindata';
import type { PageRequest, PaginatedRedelegations, Redelegation } from '@/types';

export class AbciQueryError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.name = 'AbciQueryError';
    this.code = code;
  }
}

export interface AbciQueryResult {
  value: Uint8Array;
  height: string;
}

export function resolveRpcEndpoint(chain?: Partial<ChainConfig>): string {
  const endpoints = chain?.endpoints?.rpc;
  if (!Array.isArray(endpoints)) return '';
  for (const item of endpoints) {
    const addr = item?.address?.trim();
    if (addr) return addr.replace(/\/+$/, '');
  }
  return '';
}

export async function queryAbci(
  rpcEndpoint: string,
  path: string,
  data: Uint8Array,
  height?: string | number,
  signal?: AbortSignal
): Promise<AbciQueryResult> {
  const base = rpcEndpoint.trim().replace(/\/+$/, '');
  if (!base) {
    throw new AbciQueryError('No RPC endpoint is configured for this chain.');
  }

  const params = new URLSearchParams();
  params.set('path', `"${path}"`);
  params.set('data', `0x${toHex(data)}`);
  params.set('prove', 'false');
  if (height !== undefined && height !== null && String(height) !== '') {
    params.set('height', String(height));
  }

  const response = await fetch(`${base}/abci_query?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}, ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    const msg =
      payload.error?.data ||
      payload.error?.message ||
      JSON.stringify(payload.error);
    throw new AbciQueryError(`RPC error: ${msg}`);
  }

  const abci = payload?.result?.response;
  if (!abci || typeof abci !== 'object') {
    throw new AbciQueryError('Malformed ABCI query response.');
  }

  const code = Number(abci.code ?? 0);
  if (code !== 0) {
    const detail = abci.log || abci.info || `ABCI error code ${code}`;
    throw new AbciQueryError(String(detail), code);
  }

  const value = abci.value ? fromBase64(String(abci.value)) : new Uint8Array();
  return {
    value,
    height: abci.height !== undefined ? String(abci.height) : '',
  };
}

export function encodeProtoPageRequest(page?: PageRequest) {
  if (!page) {
    return {
      limit: 10,
      countTotal: false,
    };
  }
  return {
    key: page.key ? fromBase64(page.key) : new Uint8Array(),
    offset: !page.key && page.offset !== undefined ? page.offset : 0,
    limit: page.limit || 10,
    countTotal: Boolean(page.count_total),
    reverse: Boolean(page.reverse),
  };
}

function toIsoTimestamp(ts?: { seconds: any; nanos: number } | Date): string {
  if (!ts) return '';
  if (ts instanceof Date) return ts.toISOString();
  const seconds = typeof ts.seconds === 'number' ? ts.seconds : Number(ts.seconds?.toString() || 0);
  const millis = seconds * 1000 + Math.floor((ts.nanos || 0) / 1_000_000);
  return new Date(millis).toISOString();
}

export async function queryValidatorRedelegations(
  rpcEndpoint: string,
  srcValidatorAddr: string,
  page?: PageRequest,
  signal?: AbortSignal
): Promise<PaginatedRedelegations> {
  const reqBytes = QueryRedelegationsRequest.encode(
    QueryRedelegationsRequest.fromPartial({
      srcValidatorAddr,
      pagination: encodeProtoPageRequest(page),
    })
  ).finish();

  const { value } = await queryAbci(
    rpcEndpoint,
    '/cosmos.staking.v1beta1.Query/Redelegations',
    reqBytes,
    undefined,
    signal
  );

  if (!value.length) {
    return {
      redelegation_responses: [],
      pagination: {},
    };
  }

  const decoded = QueryRedelegationsResponse.decode(value);
  const redelegation_responses: Redelegation[] = (
    decoded.redelegationResponses || []
  ).map((item) => ({
    redelegation: {
      delegator_address: item.redelegation?.delegatorAddress || '',
      validator_src_address: item.redelegation?.validatorSrcAddress || '',
      validator_dst_address: item.redelegation?.validatorDstAddress || '',
    },
    entries: (item.entries || []).map((entry) => ({
      redelegation_entry: {
        creation_height: entry.redelegationEntry?.creationHeight
          ? entry.redelegationEntry.creationHeight.toString()
          : '0',
        completion_time: toIsoTimestamp(
          entry.redelegationEntry?.completionTime
        ),
        initial_balance: entry.redelegationEntry?.initialBalance || '0',
        shares_dst: entry.redelegationEntry?.sharesDst || '0',
      },
      balance: entry.balance || '0',
    })),
  }));

  const nextKeyBytes = decoded.pagination?.nextKey;
  const next_key =
    nextKeyBytes && nextKeyBytes.length > 0 ? toBase64(nextKeyBytes) : '';

  return {
    redelegation_responses,
    pagination: {
      next_key: next_key || undefined,
      total: decoded.pagination?.total
        ? decoded.pagination.total.toString()
        : undefined,
    },
  };
}
