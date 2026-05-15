# Liquidation Dashboard Data

## Hardcoded Data

The `Positions` dashboard reads static Silo metadata only from local snapshot files:

- `src/data/liquidation/silos/arbitrum.json`
- `src/data/liquidation/silos/avalanche.json`
- `src/data/liquidation/silos/ethereum.json`
- `src/data/liquidation/silos/injective.json`
- `src/data/liquidation/silos/sonic.json`
- `src/data/liquidation/silos/xdc.json`

Each snapshot record stores:

- `chainId`, `chainKey`
- `siloAddress` (tracked market address)
- `siloConfigAddress`
- `siloId`
- `tokenAddress`, `tokenSymbol`, `tokenDecimals`
- full `siloConfig` object from `SiloConfig.getConfig(siloAddress)` fetched through RPC

## Runtime Data (Not Hardcoded)

The dashboard fetches live values at runtime:

- RPC multicall: `getCollateralAndProtectedTotalsStorage`, `totalAssets`, `getLiquidity`, `getDebtAssets`
- GraphQL (`api-v3`): open position counts per market and borrower position lists

## Snapshot Update Policy

Static snapshot files are updated only via CI workflows:

- Full refresh (`liquidation-full-refresh.yml`)
- Add or refresh one silo (`liquidation-add-silo.yml`)
- Remove one silo (`liquidation-remove-silo.yml`)

PR creation is change-driven:

- if snapshot changed: CI opens a PR
- if snapshot did not change: CI logs `no changes detected` and exits without PR

## Local Commands

Use the sync script directly when needed:

- `node scripts/sync-liquidation-silos.mjs full`
- `node scripts/sync-liquidation-silos.mjs add --chainKey=arbitrum --siloAddress=0x...`
- `node scripts/sync-liquidation-silos.mjs remove --chainKey=arbitrum --siloAddress=0x...`

Optional env overrides for test runs:

- `TEST_API_LIMIT`
- `TEST_GRAPH_LIMIT`
- `EARN_SILOS_URL`
- `NEXT_PUBLIC_RPC_ETHEREUM`
- `NEXT_PUBLIC_RPC_ARBITRUM`
- `NEXT_PUBLIC_RPC_AVALANCHE`
- `NEXT_PUBLIC_RPC_INJECTIVE`
- `NEXT_PUBLIC_RPC_SONIC`
- `NEXT_PUBLIC_RPC_XDC`
