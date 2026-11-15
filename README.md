<div align="center">

![Ping Wallet](./public/logo.svg)

<h1>Ping Dashboard</h1>

**Ping Dashboard is not only an explorer but also a wallet and more ... 🛠**

[![version](https://img.shields.io/github/tag/ping-pub/explorer.svg)](https://github.com/ping-pub/explorer/releases/latest)
[![GitHub](https://img.shields.io/github/license/ping-pub/explorer.svg)](https://github.com/ping-pub/explorer/blob/master/LICENSE)
[![Twitter URL](https://img.shields.io/twitter/url/https/twitter.com/bukotsunikki.svg?style=social&label=Follow%20%40ping_pub)](https://twitter.com/ping_pub)
[![https://discord.gg/CmjYVSr6GW](https://img.shields.io/badge/discord-join-7289DA.svg?logo=discord&longCache=true&style=flat)](https://discord.gg/CmjYVSr6GW)


</div>

`Ping Dashboard` is a light explorer for Cosmos-based Blockchains.  https://ping.pub .

## FIRMACHAIN local prototype

Use Yarn 1.22.22 as specified in `package.json`.

```sh
cp .env.example .env.local
# Set VITE_NETWORK=testnet and VITE_CHAIN=firmachain in .env.local.
yarn install --frozen-lockfile --ignore-engines
yarn dev --host 127.0.0.1
```

Open `http://localhost:5173/firmachain`. Restart Vite after changing `.env.local`.
Vite reads environment files from this repository root. All `VITE_*` values are
public browser configuration.

RPC/LCD endpoints and token metadata are configured in
`chains/testnet/firmachain.json`. The local prototype uses `imperium-4`, the
`firma` address prefix, coin type `7777777`, and `ufct` with six decimals.
Testnet FCT has no CoinGecko price configured.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `VITE_NETWORK` | Select `mainnet` or `testnet` | Hostname containing `testnet` selects Testnet, otherwise Mainnet |
| `VITE_CHAIN` | Load only the named chain from the selected network | All chains |
| `VITE_REFRESH_INTERVAL` | Refresh interval in milliseconds | `6000` |
| `VITE_FETCH_ALL_BLOCKS` | Fetch intermediate blocks between refreshes | `false` |
| `VITE_RECENT_BLOCK_LIMIT` | Recent block cache limit | `50` |
| `VITE_DEFAULT_THEME` | Initial theme | `dark` |
| `VITE_COINGECKO_URL` | Price API base URL | `https://api.coingecko.com` |
| `VITE_GITHUB_API_URL` | IBC registry GitHub contents API | `https://api.github.com/repos/cosmos/chain-registry/contents` |
| `VITE_PINGPUB_API_URL` | IBC registry base URL | `https://registry.ping.pub` |
| `VITE_IBC_USE_GITHUB_API` | Use GitHub for IBC registry queries | `false` |

## What sets Ping Dashboard apart from other explorers?
**Ping Dashboard** stands out by providing a real-time exploration of blockchain data without relying on caching or pre-processing. It exclusively fetches data from the Cosmos full node via LCD/RPC endpoints, ensuring a truly authentic experience. This approach is referred to as the "Light Explorer."

## Are you interested in listing your blockchain on https://ping.pub?

To make this repository clean, please submit your request to https://github.com/ping-pub/ping.pub.git


## Why does Ping Dashboard rely on official/trusted third-party public LCD/RPC servers?
There are two primary reasons for this choice:

 - Trust: In a decentralized system, it is crucial to avoid relying solely on a single entity. By utilizing official/trusted third-party public LCD/RPC servers, Ping Dashboard ensures that the data is sourced from a network of trusted participants.
 - Limited Resources: As Ping Dashboard plans to list hundreds of Cosmos-based blockchains in the future, it is impractical for the Ping team to operate validators or full nodes for all of them. Leveraging trusted third-party servers allows for more efficient resource allocation.

## Donation

Your donation will help us make better products. Thanks in advance.

 - Address for ERC20: USDC, USDT, ETH
```
0x88BFec573Dd3E4b7d2E6BfD4D0D6B11F843F8aa1
```

#### Donations from project

- Point Network: 1000USDC and $1000 worth of POINT
- Bitsong: 50k BTSG
- IRISnet: 100k IRIS

## Hire us

You can hire us by submitting an issue and fund the issue on [IssueHunter](https://issuehunt.io/r/ping-pub/explorer)


## Contributors

Developers: @liangping @dingyiming

