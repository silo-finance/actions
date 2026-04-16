# Wallet, Safe App, and test rollout (frozen spec)

This document mirrors the agreed rollout: one release = one theme, easy revert. Do not edit the plan file in `.cursor/plans`; change this file when the product spec evolves.

**Implementation note (repo):** Releases 0–5 from this spec are implemented in the codebase together in one delivery: EIP-6963 picker (`src/wallet/`), wagmi `safe()` + Safe packages, `initSafeAppBridge`, three Vitest files, manifest `shortName`, README QA matrix, and [`plan/safe-apps-listing.md`](./safe-apps-listing.md).

## A. Test boundaries

- **Vitest does not replace** Rabby / Safe iframe / WalletConnect in the browser. No claim of 100% parity with manual QA.
- **Automated:** pure encoding/sorting + existing `vaultActionAuthority` tests (mock `isAddressSafeOwner` only).
- **Manual:** short matrix after Release 4 (see section F).

## B. The three Vitest files (Release 1)

| File | Function | Assertion |
|------|----------|------------|
| `src/utils/encodeSetSupplyQueue.test.ts` | `encodeSetSupplyQueueEmpty` | Valid `0x` hex; selector prefix for `setSupplyQueue` |
| `src/utils/sortDestinationsByHeadroomDesc.test.ts` | `sortDestinationsByHeadroomDesc` | Two markets; larger headroom sorts first |
| `src/utils/buildWithdrawMarketRemovalVaultCallDatas.test.ts` | `buildWithdrawMarketRemovalVaultCallDatas` | `allocations: null`, no cap zero, no `newSupplyQueue` → length 1; data starts with `updateWithdrawQueue` selector |

Out of scope for this wave: mocking `Safe.init`, Playwright, full EIP-1193 wallet mocks.

## C. EIP-6963 vs RabbyKit (decision)

| Choice | Decision |
|--------|----------|
| **EIP-6963** | **Ship in Release 2.** Standard multi-wallet discovery (Rabby, MetaMask, etc.). |
| **RabbyKit** | **Do not ship** in Releases 2–4. Revisit only if product wants a Rabby-branded modal. |

Shared code lives under `src/wallet/` (see implementation in repo).

## D. Safe Apps SDK (Release 3)

- Dependency: `@safe-global/safe-apps-sdk`.
- Module: `src/wallet/safeAppBridge.ts` — `initSafeAppBridge(): Promise<SafeAppInfo | null>`.
- When loaded inside Safe{Wallet} iframe: read `safeAddress` and `chainId`, align wagmi chain (`switchChainAsync`). Do not change `vaultActionAuthority` in this release.

## E. Release order

0. This spec in `plan/` (docs only).  
1. Three Vitest files.  
2. EIP-6963 + browser extension picker UI.  
3. Safe Apps SDK bridge + Web3 sync.  
4. Manifest / README / manual QA table.  
5. (Optional) Safe Apps catalog submission — process outside code.

## F. Manual QA checklist (minimum)

1. MetaMask injected — EOA owner `direct` path.  
2. Rabby injected — same vault as (1) if possible.  
3. WalletConnect — one `direct` or `safe_propose` flow.  
4. Safe{Wallet} → Apps → Add custom app → deployed URL — app loads; chain matches Safe (after Release 3).

## G. References

- [safe-apps-sdk](https://github.com/safe-global/safe-apps-sdk)  
- [Safe Apps docs](https://docs.safe.global/sdk/safe-apps/overview)  
- [Add custom Safe App](https://help.safe.global/en/articles/40859-add-a-custom-safe-app)  
- [Rabby integration](https://rabby.io/docs/integrating-rabby-wallet)  
- [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963)
