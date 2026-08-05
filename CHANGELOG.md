# Changelog

## [0.40.0] - 2026-08-05

### Added
- Revert "Show market-role icons on the paired other-token line."
- Hide collateral-only silos from Positions market tracking.
- Show market-role icons on the paired other-token line.
- Add LT-based collateral/debt/two-way icons on Positions markets.

## [0.39.2] - 2026-08-04

### Added
- chore: blacklist silo markets

## [0.39.1] - 2026-08-04

### Added
- Revert "chore: blacklist silo markets"

## [0.39.0] - 2026-08-04

### Fixed
- Show Positions markets Total Assets as collateral plus protected storage from getCollateralAndProtectedTotalsStorage

## [0.38.0] - 2026-08-04

### Added
- chore: blacklist silo markets

### Updated
- Target BLACKLIST SILOS pull requests at develop instead of master

### Fixed
- Run BLACKLIST SILOS with actions/checkout@v5 and actions/setup-node@v5 to drop the Node 20 action runtime warning

## [0.37.1] - 2026-08-04

### Fixed
- Recheckout master and set create-pull-request base after BLACKLIST/ADD/REMOVE push to the data branch

## [0.37.0] - 2026-08-04

### Added
- Use one data-branch root env for silo and legacy position fetches.
- Stop tracking chain silo JSON on app branches after publishing to legacy-positions.
- Pin silo Actions to master scripts and legacy-positions data writes.
- Document runtime silo snapshots and bootstrap order for the data branch.
- Publish ADD/REMOVE/BLACKLIST silo JSON to the data branch.
- Push Refresh V3 Silos snapshots to the legacy-positions data branch.
- Load Positions market snapshots via React Query from the data branch.
- Add runtime silo snapshot fetcher with fail-hard remote load.

### Updated
- Load Positions silo and legacy-position JSON from one legacy-positions branch root env; stop tracking chain silo JSON on app branches

## [0.36.0] - 2026-08-03

### Added
- Rename silo full refresh Action to hourly Refresh V3 Silos.

## [0.35.0] - 2026-08-03

### Added
- Add Positions multi-select remove UI for silo blacklist workflow.
- Wire silo sync workflows to GraphQL blacklist membership.
- Sync Positions v3 markets from GraphQL minus a durable blacklist.
- format floating point
- sort positions by desc first
- Hash Positions markets cache keys and wipe legacy localStorage once.

### Updated
- sync Positions v3 markets from GraphQL minus a durable blacklist via hourly Refresh V3 Silos, with multi-select remove UI and Blacklist Silo Action
- shorten Positions markets localStorage keys with a snapshot hash and one-shot schema wipe for oversized legacy entries
- show Positions asset/liquidity metric fractional digits in a smaller type style and inherit row colors; LTV percent sign matches that scale

### Fixed
- sort Positions market columns descending first on header click, then ascending

## [0.34.0] - 2026-07-31
### Updated
- Remove #32 (scBTC) from SONIC

## [0.33.0] - 2026-07-31
### Fixed
- keep positions market metrics loading when a single borrower `isSolvent` call reverts (e.g. broken oracle feed)
- load legacy positions for XDC and Injective from the shared positions base URL
- show the real live-LTV failure reason on the user page instead of claiming Silo Lens is missing

## [0.32.2] - 2026-06-27
### Fixed
- use private RPC_URL_* secrets in CI scripts so legacy positions and silo sync stop failing on flaky public RPC

## [0.32.1] - 2026-06-25
### Fixed
- upgrade Playwright to fix post-deploy smoke browser install (dead CDN) that caused false rollbacks

## [0.32.0] - 2026-06-24

### Updated
- Show pending IRM preset name (or raw config) on Update IRM timelock view

### Fixed
- make post-deploy smoke browser install resilient so stalled downloads no longer trigger false rollbacks

## [0.31.0] - 2026-06-24

### Added
- user lookups (#111)

## [0.30.0] - 2026-06-02

### Added
- add XDC and injective
- chore: refresh silo snapshots

## [0.29.2] - 2026-06-02
### Added
- add browser agent

### Fixed
- fix age formatting
- fix refresh on legacy positions

## [0.29.1] - 2026-06-02

### Fixed
- fix cron job: include all chains

## [0.29.0] - 2026-06-02

### Added
- fix fetching LT for positions

## [0.28.0] - 2026-05-22

### Added
- display external liquidity sources
- fix path

## [0.27.0] - 2026-05-22

### Added
- update readme
- add copy buttons for silo addresses
- fix path
- rename workflows

## [0.26.0] - 2026-05-22

### Added
- display hidden counter
- schedule pulling legacy positions for every hour
- use `legacy-positions` dir name for local positions data
- rename pull workflow to explicitly say about positions type
- move static data to other directory
- additional ai skills
- display positions on landing page

## [0.25.3] - 2026-05-21

### Fixed
- always show possitions page
- fix condition for v3 markets

## [0.25.2] - 2026-05-19

### Fixed
- ci: remove market from whitelist and static list, fix flow

## [0.25.1] - 2026-05-19

### Fixed
- ci: fix removal action

## [0.25.0] - 2026-05-19

### Added
- fix sorting by values
- improve filters

## [0.24.6] - 2026-05-19

### Fixed
- ci: remove legacy positions on market removal

## [0.24.5] - 2026-05-19

### Fixed
- ci: fix positions synchronization

## [0.24.4] - 2026-05-19

### Fixed
- fix network selection
- ci: change PR title and commit message

## [0.24.3] - 2026-05-19

### Fixed
- fix positions url
- do not commit local positions files

## [0.24.2] - 2026-05-19

### Fixed
- ci: fix output directory and better logs

## [0.24.1] - 2026-05-19

### Fixed
- ci: export borrowers

## [0.24.0] - 2026-05-19

### Added
- priority column
- moredescriptive health factor
- display market version
- display other silo metadata and liquidity warning
- support legacy positions - initial version (#71)
- chore: add or refresh liquidation silo snapshot

## Unreleased

### Added
- show collateral / debt / two-way icons before token names on Positions markets (from static LT)
- hide collateral-only silos from Positions market tracking (static LT consume filter)
- add user lookup page with multicall position, market totals, and borrower health metrics

## [0.23.0] - 2026-05-18

### Added
- extend filtering
- include any position for live monitoring
- expand LIVE monitoring candidates to include rows older than 30 minutes
- package-lock.json
- chore: add or refresh liquidation silo snapshot
- use multicall RPC fallback when the silo is missing in API
- use strict package version
- add npm ci
- hide live when no positions
- rpc policy
- live LTV monitoring

## [0.22.3] - 2026-05-15

### Fixed
- fix icon path
- unify warning configion

## [0.22.2] - 2026-05-15

### Updated
- batch positions prefetch GraphQL requests by `chainId_in` + `marketId_in` to reduce refresh query fan-out

## [0.22.1] - 2026-05-15

### Fixed
- fix base path

## [0.22.0] - 2026-05-15

### Added
- positions dashboard with static silo snapshots (#62)

## [0.21.0] - 2026-04-27
### Added
- support for Mantle and MegaETH blockchains

## [0.20.0] - 2026-04-24
### Added
- Update IRM action

### Updated
- predefined silos: pull from api

## [0.18.0] - 2026-04-23

### Added
- reverting oracle (#55)

## [0.17.0] - 2026-04-22

### Added
- add option to fix unauthorized contracts for pausing

## [0.16.0] - 2026-04-22
### Added
- Global Pause flags tracked contracts where it lacks authority

## [0.15.0] - 2026-04-22

### Added
- contract names
- suggests pause-capable contracts

### Added
- suggests pause-capable contracts

## [0.14.0] - 2026-04-22
### Added
- Global Pause: `addContract`, `removeContract` from the UI.

## [0.13.0] - 2026-04-21
### Added
- Submit Market Removal action
- Global Pause now shows a dedicated `Multisig signers`

## [0.12.0] - 2026-04-21
### Updated
- Withdraw-queue removal auto-prunes supply-queue markets with cap 0 and warns about the extra removals instead of blocking.

## [0.11.0] - 2026-04-21

### Added
- Global Pause action

## [0.10.0] - 2026-04-17

### Added
- Support for using the dApp with a Safe multisig: as a Safe App inside Safe{Wallet}, via
  Safe{Wallet} mobile over WalletConnect, and with Rabby impersonate. Owner, allocator, and
  curator actions arrive in the Safe queue as a single transaction proposal with every step
  decoded by its method name, ready for co-signer review.

### Fixed
- Readable wallet error messages — user-rejected prompts and RPC failures are now shown as short,
  human-friendly text instead of raw error objects.

## [0.9.2] - 2026-04-17

### Added
- better info about your vaults

## [0.9.1] - 2026-04-17

### Added
- improve blockchain switching

## [0.9.0] - 2026-04-17

### Added
- use multicall to reduce number of RPC calls
- improve automation for changelog

## [0.8.27] - 2026-04-17

### Fixed
- your vaults info
- display errors in UI
- fix: maximum update depth exceeded
- remove wallet autodetection

- fix linter errors
## [0.8.26] - 2026-04-17

### Fixed
- remove unnecessary "finalize_deployment" job
- revert crashing code that was added on purpose for QA

## [0.8.25] - 2026-04-17

### Fixed
- fix: choose correct tag for rollback

## [0.8.24] - 2026-04-17

### Fixed
- fix artifacts conflict

## [0.8.23] - 2026-04-17

### Fixed
- fix: try to find correct tag

## [0.8.22] - 2026-04-17

### Fixed
- fix: find last tag to rollback

## [0.8.21] - 2026-04-17

### Fixed
- fix: rollback to previous tag

## [0.8.20] - 2026-04-17

### Fixed
- fix: ensure rollback is not skipped

## [0.8.19] - 2026-04-17

### Fixed
- fix: make sure rollback job is not skipped, skip only on failed deploy

## [0.8.18] - 2026-04-17

### Fixed
- fix rollback process again

## [0.8.17] - 2026-04-17

### Fixed
- fix rollback process + version info

## [0.8.16] - 2026-04-17

### Fixed
- fix: automatic rollback

## [0.8.15] - 2026-04-17

### Fixed
- fix yaml

## [0.8.14] - 2026-04-17

### Fixed
- fix: split deployment into 3 jobs to ensure rollback is working

## [0.8.13] - 2026-04-17

### Fixed
- fix: detect when page is failing + custom error page

## [0.8.12] - 2026-04-17

### Fixed
- fix: ensure githab is notified about failed deployment
- fix: ensure issue with page rendering is detected by test

## [0.8.11] - 2026-04-17

### Fixed
- make rendering crash to test rollback
- Revert "make site crash in console, to test rollback"

## [0.8.10] - 2026-04-17

### Fixed
- notify github about failed deployment
- fix base path for smoking tests

## [0.8.9] - 2026-04-17

### Fixed
- remove rollback, github mechanism will be used.
- fix: ensure rollback process is working, add logs in ci

## [0.8.8] - 2026-04-17

### Fixed
- make site crash in console, to test rollback

## [0.8.7] - 2026-04-17

### Fixed
- smoke test and rollback

## [0.8.6] - 2026-04-16

### Fixed
- handle white spaces, eg new line for the environmental variables

## [0.8.5] - 2026-04-16

### Fixed
- fix missing "strip-hex-prefix" package
- fix packages warnings by using wagmi v3
- npm i
- revert: "fix: address connect wallet issues"

- use .nvmrc for nodejs version
## [0.8.4] - 2026-04-16

### Added
- Rollout spec [`plan/wallet-safe-rollout-spec.md`](plan/wallet-safe-rollout-spec.md) and optional Safe catalog checklist [`plan/safe-apps-listing.md`](plan/safe-apps-listing.md)
- EIP-6963 announced-wallet list in the connect UI; per-wallet connect via shared `injected` target
- wagmi `safe()` connector plus `@safe-global/safe-apps-sdk` / `safe-apps-provider` for Safe{Wallet} iframe; auto-connect when opened as a Safe App
- Vitest: `encodeSetSupplyQueueEmpty`, `sortDestinationsByHeadroomDesc`, `buildWithdrawMarketRemovalVaultCallDatas` (minimal calldata path)
- `public/manifest.json`: `shortName` for Safe App metadata

### Changed
- README: manual smoke matrix and Safe App manifest notes

### Fixed
- check if NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not empty
- fix: address connect wallet issues


## [0.8.3] - 2026-04-16

### Fixed
- fix wallet connect, add project ID

## [0.8.2] - 2026-04-15

### Added
- Wallet connection via wagmi: browser extension (injected) and optional WalletConnect (`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`)
- Vitest coverage for vault action authority (EOA vs Safe owner / signer)

### Fixed
- When the vault `owner` (or `curator`) is a Safe, treat a connected account equal to that Safe as multisig proposal mode instead of direct transactions (WalletConnect / smart-wallet edge case)

- wallet connect
## [0.8.1] - 2026-04-15

### Fixed
- improve visual styling by removing circles from cards bg

## [0.8.0] - 2026-04-15

### Fixed
- fix linter errors
- Improved automation for changelog
- automate changelog
- handle dust on reallocation
- by default reallocate funds to idle vault
- minimum gnosis compatible changes (#14)

## [0.7.2] - 2026-04-15

### Fixed
- fix how we manage url and network switch
- labels
- add network does not exist in the wallet

## [0.7.1] - 2026-04-13

### Fixed
- keep connection alive for MetaMask
- add chain to url params
- accept address from url

## [0.7.0] - 2026-04-10

### Fixed
- release 0.7.0
- fix role labels
- fix icon path

## [0.6.0] - 2026-04-10

### Fixed
- release 0.6.0
- fix submit supply queue
- better way of font size
- icons
- increase fonts
- list of my vaults

## [0.5.0] - 2026-04-09

### Fixed
- 0.5.0
- support for curator and guardian

## [0.4.0] - 2026-04-09

### Fixed
- fix linter errors
- 0.4.0
- set supply queue
- display cap

## [0.3.0] - 2026-04-08

### Fixed
- favicon

## [0.2.0] - 2026-04-08

### Added
- Withdraw-queue market removal
  Flow to remove a market from the **withdraw queue** (and optionally the **supply queue**) via the same **Safe proposal** stack.

### Fixed

- Network switching in the app shell.

## [0.1.0] - 2026-04-08

### Added — Set supply queue to zero

Initial on-chain reset of the vault supply queue via `setSupplyQueue([])`.

1. **Safe multisig** — Uses the **proposal flow** with `@safe-global/protocol-kit` and `@safe-global/api-kit` against the Safe Transaction Service (the integration surface that will matter when those SDKs or the service API change).

2. **No Safe developer API key** — Proposals go to **legacy** Transaction Service hosts (`safe-transaction-<network>.safe.global/api`) instead of authenticated `api.safe.global/tx-service`. If Safe turns off legacy hosts or mandates JWT for all traffic, this approach must be replaced or a key + official base URLs added.

3. **Wallets / roles** — Supports **EOA** vault owners (direct transaction to the vault) and **Gnosis Safe** vault owners (multisig proposal carrying the same vault **calldata**). Other contract owners are unsupported here.

4. **Manual chain map** — Which chains use which legacy Transaction Service base and which EIP-3770 short name is expected by Safe{Wallet} is **hand-maintained**; new chains or upstream renames are the usual source of “works on A, fails on B” regressions.
