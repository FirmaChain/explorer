# Changelog

All notable modifications made in this fork (`FirmaChain/explorer`) of [`ping-pub/explorer`](https://github.com/ping-pub/explorer) (forked from commit `39a010d`) are documented in this file.

This project is licensed under the **GNU General Public License v2.0** (see [LICENSE](./LICENSE)).

---

## [Unreleased] - 2026-11-18

### License & Compliance
- **Removed commercial-licensed chart dependencies**: Removed `apexcharts` (`^8.9.0`), `vue3-apexcharts` (`^1.11.3`), and transitive `apex-commons` from `package.json` and `yarn.lock`.
- **Replaced charts with custom Vue + SVG implementations**:
  - Added `src/components/charts/AreaChart.vue` for market price/volume and portfolio trend charts (`PriceMarketChart.vue`, `src/modules/wallet/portfolio.vue`).
  - Reimplemented `src/components/charts/DonutChart.vue` using inline SVG slices, percentage labels, and interactive legend.
  - Reimplemented `src/components/charts/TxsInBlocksChart.vue` using inline SVG bars and block transaction tooltips.
  - Reimplemented `src/components/ValidatorCommissionRate.vue` gauge arc using inline SVG.
  - Replaced `src/components/charts/apexChartConfig.ts` with `src/components/charts/chartConfig.ts` containing only theme/color helpers used by the SVG charts.
  - Removed obsolete `vue3-apexcharts` test stubs from `tests/03-validator-redelegations.test.mjs`, `tests/helpers/validator-fixture.mjs`, and `tests/helpers/validator-unbonding-fixture.mjs`.
- **GPL-2.0 Section 2(a) & Section 3 alignment**:
  - Added prominent modification notices with change dates to modified source files.
  - Updated `src/layouts/components/NavFooter.vue` `License` and `Github` links to point to `https://github.com/FirmaChain/explorer` while preserving original `Ping.pub` attribution.

---

## 2026-11-18 (PR #8)

- **Supply**: Handle missing denom metadata, format token supply amounts, use fetched IBC metadata logos/symbols, and hide `UFCTTESTTTTT0` and `UUET` tokens from the supply page (`28a45e8`, `6870f76`, `31f23a6`).
- **Uptime**: Enhance validator uptime view with `TombstoneBadge` (`371ab20`).
- **Dashboard**: Open community link buttons in a new tab (`59457cf`).
- **Dependencies & Security**:
  - Upgrade Yarn to `4.18.1` and update project dependencies, components, libs, and tests (`2bb55a3`, `97caf24`).
  - Remove unused `unplugin-vue-define-options` (`b85f88a`).
  - Update CSP for `md-editor-v3` and remove Slise ads and Google Analytics (`17234c7`).

---

## 2026-11-17 (PR #4, #5, #7)

- **Dashboard & Loader (PR #7)**:
  - Redesign consensus, online voting power, and token distribution widgets (`e8701b2`, `587653c`).
  - Remove ecosystem sidebar section, all-blockchains page, and favorite pages (`4f34375`).
  - Add theme-aware FIRMACHAIN initial loading screen (`417388c`).
  - Redesign governance proposal tally, status/date display, and empty controls (`9aeda4c`).
- **Connection & Polling (PR #5)**:
  - Fix explorer connection status, start block polling before staking initialization, and observe RPC readiness without polling (`5a29538`, `02b6acb`, `9bc8902`).
- **Explorer Features & Performance (PR #4)**:
  - Port FIRMACHAIN explorer features, UI improvements, and automated test suite under `tests/` (`c13c7a9`, `f3d23e0`).
  - Add validator avatars on recent block proposers and block signatures (`da7c124`, `5f42aa0`).
  - Paginate block signatures by 10 and skip stale height reloads (`991e50b`).
  - Remove Application Versions dashboard card and 34% validator concentration badge (`1a62dbc`, `f1b9629`).
  - Offload CoinGecko polling to a Web Worker (`src/workers/priceWorker.ts`) with 60s cache TTL, cache validator set for 60s on Online Voting Power, and schedule consensus polling with backoff/visibility pause (`505900b`, `04cbe75`, `fb928d0`).
  - Align countdown seconds grid, add footer horizontal padding, and improve governance proposal detail layout and markdown styling (`d29d3dc`, `c9b63f6`).

---

## 2026-11-16 ~ 2026-11-17 (PR #1, #2, #3)

- **Chain Configuration & Branding**:
  - Configure FIRMACHAIN mainnet (`chains/mainnet/firmachain.json`) and testnet (`chains/testnet/firmachain.json`), removing unused default chain configs (`b332a3b`).
  - Customize FIRMACHAIN explorer branding and logo (`public/firmachain.svg`, `index.html`, `DefaultLayout.vue`) (`b8bc30c`).
  - Configure public FIRMACHAIN RPC/API node endpoints (`9630919`).
