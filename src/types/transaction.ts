// Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE)
import type { Coin, Key, PaginatedResponse } from './common';

export interface Tx {
  '@type'?: string;
  body: {
    messages: { '@type': string; amount?: Coin[]; packet?: { data: string } }[];
    memo: string;
    timeout_height: string;
    extension_options: any[];
    non_critical_extension_options: any[];
  };
  auth_info: {
    signer_infos: [
      {
        public_key: Key;
        mode_info: {
          single?: {
            mode: string; // "SIGN_MODE_DIRECT"
          };
        };
        sequence: string;
      }
    ];
    fee: {
      amount: Coin[];
      gas_limit: string;
      payer: string;
      granter: string;
    };
  };
  signatures: string[];
}

export interface Attributes {
  index?: boolean;
  key: string;
  value: string;
}

export interface TxLogEvent {
  type: string;
  attributes: Attributes[];
}

export interface TxLog {
  msg_index: number;
  log: string;
  events: TxLogEvent[];
}

export interface TxResponse {
  height: string;
  txhash: string;
  codespace: string;
  code: number;
  data: string;
  raw_log: string;
  logs: TxLog[];
  info: string;
  gas_wanted: string;
  gas_used: string;
  tx: Tx;
  timestamp: string;
  events: TxLogEvent[];
}

export interface PaginatedTxs extends PaginatedResponse {
  txs: Tx[];
  tx_responses: TxResponse[];
}
