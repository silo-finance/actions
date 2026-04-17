# Changelog

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
