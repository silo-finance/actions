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

## Definition of done

- Request implemented and scoped correctly.
- RPC reads batched where applicable.
- ABI changes live in JSON files.
- Writes use `estimateGas` preflight path.
- UI is brand-consistent.
- Dependencies are exact-pinned and sanity-checked.
- Lint/type-check/build are clean.
- Branch-appropriate changelog/versioning policy is respected.
