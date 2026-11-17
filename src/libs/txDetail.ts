import type { Attributes, TxLog, TxLogEvent } from '@/types';

export interface NormalizedTxMessage {
  index: number;
  typeUri: string;
  shortType: string;
  category: string;
  nestedTypes: string[];
  raw: Record<string, any>;
  display: Record<string, any>;
}

export interface MessageFilterOption {
  value: string;
  label: string;
  count: number;
}

export function classifyMessageType(typeUri?: string): {
  typeUri: string;
  shortType: string;
  category: string;
} {
  const raw = typeof typeUri === 'string' ? typeUri.trim() : '';
  if (!raw) {
    return { typeUri: 'unknown', shortType: 'Unknown', category: 'unknown' };
  }
  const parts = raw.split('.');
  const shortType = parts[parts.length - 1] || raw;
  let category = 'other';
  if (raw.includes('.bank.')) category = 'bank';
  else if (raw.includes('.staking.')) category = 'staking';
  else if (raw.includes('.distribution.')) category = 'distribution';
  else if (raw.includes('.gov.')) category = 'gov';
  else if (raw.includes('.ibc.') || raw.startsWith('/ibc.')) category = 'ibc';
  else if (raw.includes('.authz.')) category = 'authz';
  else if (raw.includes('.feegrant.')) category = 'feegrant';
  else if (raw.includes('.wasm.') || raw.includes('.cosmwasm.')) category = 'wasm';
  return { typeUri: raw, shortType, category };
}

function collectNestedTypes(msg: Record<string, any>): string[] {
  const nested: string[] = [];
  const candidates = [
    ...(Array.isArray(msg?.msgs) ? msg.msgs : []),
    ...(Array.isArray(msg?.messages) ? msg.messages : []),
    ...(msg?.msg && typeof msg.msg === 'object' ? [msg.msg] : []),
  ];
  for (const child of candidates) {
    if (child && typeof child === 'object') {
      const childType = child['@type'] || child.typeUrl;
      if (typeof childType === 'string' && childType.trim()) {
        nested.push(classifyMessageType(childType).shortType);
      }
    }
  }
  return nested;
}

export function normalizeTxMessages(
  messages: any[] | undefined,
  decodeBase64: (v: string) => string
): NormalizedTxMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg, index) => {
    const safeMsg = msg && typeof msg === 'object' ? msg : { value: msg };
    const { typeUri, shortType, category } = classifyMessageType(
      safeMsg['@type'] || safeMsg.typeUrl
    );
    const nestedTypes = collectNestedTypes(safeMsg);
    // Create a shallow copy for display so the original response object is never mutated
    const display =
      safeMsg.packet?.data && typeof safeMsg.packet.data === 'string'
        ? { ...safeMsg, message: decodeBase64(safeMsg.packet.data) }
        : safeMsg;

    return {
      index,
      typeUri,
      shortType,
      category,
      nestedTypes,
      raw: safeMsg,
      display,
    };
  });
}

export function buildMessageFilterOptions(
  messages: NormalizedTxMessage[]
): MessageFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const msg of messages) {
    const existing = counts.get(msg.typeUri);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(msg.typeUri, { label: msg.shortType, count: 1 });
    }
  }
  return [
    { value: 'all', label: 'All', count: messages.length },
    ...Array.from(counts.entries()).map(([value, info]) => ({
      value,
      label: info.label,
      count: info.count,
    })),
  ];
}

export function filterTxMessages(
  messages: NormalizedTxMessage[],
  selectedType: string
): NormalizedTxMessage[] {
  if (!selectedType || selectedType === 'all') return messages;
  return messages.filter((msg) => msg.typeUri === selectedType);
}

export function normalizeTxLogs(logs: unknown): TxLog[] {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((item): item is Record<string, any> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => ({
      msg_index: Number.isFinite(Number(item.msg_index)) ? Number(item.msg_index) : idx,
      log: typeof item.log === 'string' ? item.log : item.log != null ? JSON.stringify(item.log) : '',
      events: normalizeTxEvents(item.events),
    }));
}

export function normalizeTxEvents(events: unknown): TxLogEvent[] {
  if (!Array.isArray(events)) return [];
  return events
    .filter((ev): ev is Record<string, any> => Boolean(ev && typeof ev === 'object'))
    .map((ev) => ({
      type: typeof ev.type === 'string' && ev.type ? ev.type : 'unknown',
      attributes: Array.isArray(ev.attributes)
        ? ev.attributes
            .filter((attr): attr is Attributes => Boolean(attr && typeof attr === 'object'))
            .map((attr) => ({
              key: attr.key != null ? String(attr.key) : '',
              value: attr.value != null ? String(attr.value) : '',
              index: attr.index,
            }))
        : [],
    }));
}
