import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { h, nextTick, reactive } from 'vue';
import { sha256 } from '@cosmjs/crypto';
import { toBase64, toHex } from '@cosmjs/encoding';
import { loadProduct, mount, root } from './helpers/validator-renderer.mjs';
import { findAll, text } from './helpers/validator-renderer.mjs';

function makeValidator(seed, moniker, identity = '') {
  const pub = Buffer.alloc(32, seed);
  const bytes = sha256(pub).slice(0, 20);
  return {
    operator_address: `firmavaloper1val${seed}`,
    description: { moniker, identity },
    consensus_pubkey: {
      '@type': '/cosmos.crypto.ed25519.PubKey',
      key: toBase64(pub),
    },
    consensusHex: toHex(bytes).toUpperCase(),
    consensusB64: toBase64(bytes),
  };
}

test('uptime page separates index column, renders validator avatar + link, and displays intuitive tombstoned status', async (t) => {
  const originalDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (originalDoc === undefined) delete globalThis.document;
    else globalThis.document = originalDoc;
  });

  const addresses = await loadProduct('src/libs/address.ts');
  const validatorAvatar = await loadProduct('src/libs/validatorAvatar.ts');

  const v1 = makeValidator(1, 'AlphaNode', 'KEY1');
  const v2 = makeValidator(2, 'BetaNode');
  const v3 = makeValidator(3, 'GammaNode');

  // Encode valcons bech32 via @cosmjs/encoding or mock valconsToBase64 cleanly
  const addrMap = new Map([
    [`valcons-${v1.consensusB64}`, v1.consensusB64],
    [`valcons-${v2.consensusB64}`, v2.consensusB64],
    [`valcons-${v3.consensusB64}`, v3.consensusB64],
  ]);

  const libsMock = {
    consensusPubkeyToHexAddress: addresses.consensusPubkeyToHexAddress,
    valconsToBase64: (addr) => addrMap.get(addr) || addr,
  };

  setActivePinia(createPinia());

  const baseStore = reactive({
    recents: [],
    latest: null,
    $subscribe: () => () => {},
  });

  const chainStore = reactive({
    chainName: 'firmachain',
    isConsumerChain: false,
    rpc: {
      getSlashingParams: async () => ({
        params: {
          signed_blocks_window: '100',
          min_signed_per_window: '0.5',
        },
      }),
      getSlashingSigningInfos: async () => ({
        info: [
          {
            address: `valcons-${v1.consensusB64}`,
            start_height: '1',
            index_offset: '50',
            jailed_until: '1970-01-01T00:00:00Z',
            tombstoned: false,
            missed_blocks_counter: '2',
          },
          {
            address: `valcons-${v2.consensusB64}`,
            start_height: '1',
            index_offset: '10',
            jailed_until: '2026-11-18T00:00:00Z',
            tombstoned: true,
            missed_blocks_counter: '80',
          },
        ],
      }),
    },
  });

  const stores = {
    useBaseStore: () => baseStore,
    useBlockchain: () => chainStore,
    useStakingStore: () => ({
      validators: [v1, v2, v3],
      keybase: async (identity) =>
        identity === 'KEY1'
          ? {
              them: [
                {
                  pictures: {
                    primary: { url: 'https://img.example/alpha.png' },
                  },
                },
              ],
            }
          : { them: [] },
    }),
    useBankStore: () => ({}),
    useDashboard: () => ({ chains: {}, coingecko: {}, prices: {} }),
  };

  const formatter = await loadProduct('src/stores/useFormatter.ts', {
    '@/stores': stores,
    '@/libs': addresses,
    pinia: { defineStore },
  });
  stores.useFormatter = formatter.useFormatter;

  const iconStub = {
    Icon: (p) => h('span', { 'data-icon': p.icon }),
  };

  const uptimeBar = (await loadProduct('src/components/UptimeBar.vue', {}))
    .default;
  const tombstoneBadge = (
    await loadProduct('src/components/TombstoneBadge.vue', {
      '@iconify/vue': iconStub,
    })
  ).default;

  const routerLinkStub = {
    RouterLink: (p, { slots }) => h('a', { href: p.to }, slots.default?.()),
  };

  const uptimePage = (
    await loadProduct('src/modules/[chain]/uptime/index.vue', {
      '@/stores': stores,
      '@/libs': libsMock,
      '@/libs/validatorAvatar': validatorAvatar,
      '@/components/UptimeBar.vue': uptimeBar,
      '@/components/TombstoneBadge.vue': tombstoneBadge,
      '@iconify/vue': iconStub,
      'vue-router': routerLinkStub,
    })
  ).default;

  const mounted = mount(uptimePage, { chain: 'firmachain' });
  t.after(() => mounted.app.unmount());

  // Flush async onMounted promises and Keybase lookup
  await new Promise((r) => setTimeout(r, 20));
  await nextTick();

  // Verify Blocks view links and avatar
  const blockLinks = findAll(
    mounted.container,
    (el) =>
      el.type === 'a' &&
      el.props.href === `/firmachain/staking/${v1.operator_address}`
  );
  assert.ok(
    blockLinks.length >= 2,
    'Expected validator link in both Blocks and Overall views'
  );

  // Switch to Overall tab
  const overallTab = findAll(
    mounted.container,
    (el) => el.type === 'a' && text(el).trim() === 'uptime.overall'
  )[0];
  assert.ok(overallTab, 'Expected Overall tab');
  overallTab.props.onClick();
  await nextTick();

  const tables = findAll(mounted.container, (el) => el.type === 'table');
  assert.equal(tables.length, 1);
  const table = tables[0];

  // Header has separate '#' and 'account.validator' columns
  const headerCells = findAll(
    findAll(table, (el) => el.type === 'thead')[0],
    (el) => el.type === 'td' || el.type === 'th'
  ).map((el) => text(el).trim());
  assert.equal(headerCells[0], '#');
  assert.equal(headerCells[1], 'account.validator');
  assert.equal(headerCells[6], 'uptime.tombstoned');

  // Body rows check
  const bodyRows = findAll(
    findAll(table, (el) => el.type === 'tbody')[0],
    (el) => el.type === 'tr'
  );
  assert.equal(bodyRows.length, 3);

  // Row 1: index '1', validator name 'AlphaNode' (without '1. '), avatar img, link, Tombstoned = Normal
  const r1Cells = bodyRows[0].children.filter((c) => c.type === 'td');
  assert.equal(text(r1Cells[0]).trim(), '1');
  assert.equal(text(r1Cells[1]).trim(), 'AlphaNode');
  const r1Link = findAll(r1Cells[1], (el) => el.type === 'a')[0];
  assert.equal(r1Link.props.href, `/firmachain/staking/${v1.operator_address}`);
  const r1Img = findAll(r1Cells[1], (el) => el.type === 'img')[0];
  assert.equal(r1Img.props.src, 'https://img.example/alpha.png');
  assert.equal(text(r1Cells[6]).trim(), 'uptime.normal');
  assert.ok(!text(r1Cells[6]).includes('false'));

  // Row 2: index '2', validator name 'BetaNode', fallback icon, link, Tombstoned = Tombstoned
  const r2Cells = bodyRows[1].children.filter((c) => c.type === 'td');
  assert.equal(text(r2Cells[0]).trim(), '2');
  assert.equal(text(r2Cells[1]).trim(), 'BetaNode');
  const r2Link = findAll(r2Cells[1], (el) => el.type === 'a')[0];
  assert.equal(r2Link.props.href, `/firmachain/staking/${v2.operator_address}`);
  const r2FallbackIcon = findAll(
    r2Cells[1],
    (el) => el.props?.['data-icon'] === 'mdi-help-circle-outline'
  )[0];
  assert.ok(
    r2FallbackIcon,
    'Expected fallback icon for validator without identity'
  );
  assert.equal(text(r2Cells[6]).trim(), 'uptime.tombstoned');
  assert.ok(!text(r2Cells[6]).includes('true'));

  // Row 3: missing signing info -> '-'
  const r3Cells = bodyRows[2].children.filter((c) => c.type === 'td');
  assert.equal(text(r3Cells[0]).trim(), '3');
  assert.equal(text(r3Cells[6]).trim(), '-');
});

test('all locale files define uptime tombstoned status keys', async () => {
  const locales = ['en', 'ko', 'ja', 'zh', 'de', 'es', 'id'];
  for (const locale of locales) {
    const raw = await readFile(
      `${root}src/plugins/i18n/locales/${locale}.json`,
      'utf8'
    );
    const json = JSON.parse(raw);
    assert.ok(json.uptime?.normal, `${locale} missing uptime.normal`);
    assert.ok(
      json.uptime?.tombstoned_true_tip,
      `${locale} missing uptime.tombstoned_true_tip`
    );
    assert.ok(
      json.uptime?.tombstoned_false_tip,
      `${locale} missing uptime.tombstoned_false_tip`
    );
  }
});
