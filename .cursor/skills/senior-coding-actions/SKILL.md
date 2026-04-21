---
name: senior-coding-actions
description: Senior engineer operating protocol for the `actions` repo. Use for any task that changes code (TypeScript/React/Next.js, web3 RPC/multicall logic, ABI/contract integration, transactions, UI, dependencies). Enforces multicall-first reads, JSON-first ABIs, estimateGas preflight for writes, brand-consistent UI, `.nvmrc` Node runtime, clean lint/type-check/build, exact dependency versions with a quick security sanity check, and branch-aware changelog/versioning.
---

# Senior Coding Standard — `actions`

Use this as the default execution protocol for code-change tasks in this repository.
Optimize for correctness, low risk, and maintainability.

## When this skill applies

Apply this skill when the task changes code or behavior (features, fixes, refactors, UI, web3 integration, contracts, dependencies).

Do not force this skill for purely exploratory/planning/chat tasks with no code edits.

## Execution workflow

### 1) Prepare context and runtime

Before Node/npm/build/lint/test commands:

1. Read `.nvmrc`.
2. Use that version via `nvm use` in the same shell session.
3. Reuse existing abstractions and patterns before adding new ones.

Also determine the current branch (`git rev-parse --abbrev-ref HEAD`) because release/hotfix flows have stricter versioning rules.

### 2) Implement with repository policies

### RPC reads: multicall first

- New reads in the same flow/page/effect must be joined into an existing multicall batch.
- Standalone reads are allowed only when they are genuinely independent by lifecycle/trigger.

Rule of thumb: if reads could fit one round trip, batch them.

### ABIs: JSON-first only

- Never author or extend ABI definitions inline in TypeScript.
- If ABI content is missing, stop and ask the user:
  - agent should generate/update JSON now, or
  - user will provide the JSON file.

### Writes: estimateGas preflight

Before any write transaction:

1. Build the final tx payload.
2. Call `estimateGas`.
3. If estimate reverts: decode and surface a readable reason; do not open wallet prompt.
4. If estimate succeeds: reuse that gas value for send (with repo-standard buffer only if needed).

Applies to single-call and multicall-based writes.

### Vault features: consult the contract first

When the task touches vault functionality (reads, writes, roles, queues, allocations, deposits/withdrawals, fees, pausing, or anything else that ends up interacting with the vault contract), read the contract source BEFORE writing UI or call-site logic.

Authoritative source: [`../silo-contracts-v2/silo-vaults/contracts/SiloVault.sol`](../silo-contracts-v2/silo-vaults/contracts/SiloVault.sol) (sibling repo at `neoRacer/silo-contracts-v2/silo-vaults/contracts/SiloVault.sol`). Follow its imports into the dependent libraries/interfaces used by the function you touch.

For every new vault action, extract from the contract and encode in the implementation:

- Access control: which role/caller can invoke it, and under what timelock / pending state.
- Preconditions: required state (e.g. queues, caps, asset lists, pause flags, pending proposals) that must hold.
- Custom errors: enumerate the exact `error Name(...)` revert types the function can throw and map each to a short, human-readable UI hint surfaced via the existing error surface.
- Side effects and ordering: what events fire, what timelock starts, what must be called next.

Use the contract knowledge to:

- Gate the UI (disable / hide actions that cannot succeed in the current state, with a tooltip explaining why).
- Power the `estimateGas` preflight: known custom errors get specific user-facing messages instead of raw hex.
- Avoid guessing based on ABI alone — the ABI says what can be called, the contract says when it actually works.

### UI consistency

- Reuse existing components, tokens, spacing, and typography.
- Avoid one-off visual styles unless explicitly requested.

### Language policy

- Use English only across the repository.
- All code comments, changelog entries, docs, user-facing strings, and commit/PR text written by the agent must be in English.
- If source content is provided in another language, keep technical identifiers as-is but write new project content in English.

### Dependencies

- Pin exact versions (`no ^`, `no ~`).
- Do a quick security sanity check for newly added/upgraded packages before finalizing the version.

### Comments

Add short comments only for non-obvious constraints, legacy traps, or required workarounds.

### 3) Validate before handoff

Run and pass:

- `npm run lint`
- `npm run type-check`
- `npm run build`

If logic-heavy code changed, run targeted tests for touched modules.
Do not hand off with red gates.

### 4) Changelog and versioning (branch-aware)

Apply this step for delivered code changes unless the user explicitly asks to skip changelog updates.

### `release/*` or `hotfix/*`

- Bump `package.json` version (use version from branch name if encoded).
- Add/update matching top changelog section: `## [x.y.z] - YYYY-MM-DD`.
- Add one-line entry under `Added`, `Updated`, or `Fixed`.

### Any other branch

- Do not change `package.json` version.
- Add one-line entry under `## [Unreleased]` in the correct category.

### Entry rules (apply to every changelog write)

- Exactly one line per entry. No two-line descriptions, no multi-sentence paragraphs, no bullet sub-lists under a single entry. If the change feels too large for one line, the line is wrong, not the rule — rewrite it shorter and more user-facing.
- One feature = one entry. While you are iterating on the same implementation (first commit adds the feature, follow-up commits tweak / polish / fix issues introduced by that same work), DO NOT append a new `Fixed: ...` bullet for your own in-progress fixes. Update (or leave) the existing entry instead. A separate `Fixed` entry is only appropriate when fixing a bug that lives outside the current feature's scope (a pre-existing bug, or a regression in unrelated code).
- Choose the section by the nature of the overall change, not by the nature of the latest commit: `Added` for new capability, `Updated` for improvement of existing behavior, `Fixed` for a standalone bug fix.

## Definition of done

- Request implemented and scoped correctly.
- RPC reads batched where applicable.
- ABI changes live in JSON files.
- Writes use `estimateGas` preflight path.
- UI is brand-consistent.
- Dependencies are exact-pinned and sanity-checked.
- Lint/type-check/build are clean.
- Branch-appropriate changelog/versioning policy is respected.
