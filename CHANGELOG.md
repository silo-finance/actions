# Changelog

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
