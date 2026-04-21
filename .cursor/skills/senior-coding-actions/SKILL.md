---
name: senior-coding-actions
description: Senior engineer operating standard for the `actions` repo. Use whenever the task involves programming in this repo — adding features, refactoring, fixing bugs, editing TypeScript/React/Next.js code, touching RPC/multicall logic, ABI/contract interfaces, writing on-chain transactions, UI work, installing packages, or anything that ends with a code change. Enforces multicall-first RPC policy, JSON-first ABI policy, estimateGas preflight before sending transactions, brand-consistent UI, Node version via `.nvmrc`, zero linter/build errors, strict dependency versions with a security check, architectural comments for legacy, and branch-aware CHANGELOG + `package.json` version bump (release/hotfix vs Unreleased).
---

# Senior Coding Standard — `actions`

Operate as an experienced senior engineer. Favor simplicity, correctness, and long-term maintainability over clever one-offs. Before coding, read enough surrounding code to understand the real context; after coding, verify the work actually passes the gates below.

## 1. Node runtime — always use `.nvmrc`

Before running ANY terminal command that executes Node, npm, build, lint, type-check, tests, or scripts:

1. Read the Node version from `.nvmrc`.
2. Run `nvm use` (which picks up `.nvmrc`) in the same shell session, or prefix the command with it.
3. If `nvm` is not active in the session, explicitly `nvm use $(cat .nvmrc)` first.

Never assume the default system Node matches. Mismatched Node versions cause silent build differences.

## 2. RPC policy — multicall first

The project minimizes RPC calls. Before adding any new on-chain read:

- Check whether the same page / same user flow / same effect already performs RPC reads. If yes, the new read MUST be added to the existing multicall batch, not issued as a separate call.
- Only issue a standalone RPC call when the read is genuinely independent (different trigger, different lifecycle, different page).
- When adding a new flow that performs multiple independent reads at once, batch them through multicall from the start.
- Writes (transactions) are not multicalled the same way, but if multiple independent reads happen around a write, still batch the reads.

Rule of thumb: if two reads could have fit into one round-trip, they MUST.

## 3. ABI policy — JSON first, never hand-written TS

Contract interfaces (ABIs) live in JSON files. Never author or extend an ABI directly in TypeScript.

When a needed method, event, or full ABI is missing from the JSON files:

1. Stop coding against it.
2. Ask the user which path they want:
   - Option A: agent generates / updates the ABI JSON file automatically (from a source the user points to, e.g. verified contract, repo, or artifact).
   - Option B: the user will drop the ABI JSON into the repo themselves, and the task pauses until they do.
3. Only after the JSON exists, reference it from TypeScript via the normal import path used in this repo. Do not inline an ABI literal in `.ts` / `.tsx` as a workaround.

Rule of thumb: if you find yourself typing `as const` on an ABI array inside a TypeScript file, you are doing it wrong — go back to the JSON.

## 4. Transaction preflight — estimateGas first

Before broadcasting ANY on-chain write, run an `estimateGas` call for that transaction. Purpose: surface custom errors / revert reasons to the user BEFORE the wallet prompt, and reuse the returned gas value for the actual send (we need a gas figure anyway).

Flow for every write:

1. Build the exact tx payload you intend to send (`to`, `data`, `value`, `from`).
2. Call `estimateGas` against it.
   - If it reverts: decode the error (custom error selector, revert string, or raw data), show a human-readable message via the existing error surface, and STOP — do not open the wallet prompt.
   - If it succeeds: keep the returned gas value.
3. Send the transaction reusing the estimated gas (optionally with a small buffer if the repo convention requires one).

Additional rules:

- This applies to single-call sends AND to multicall batches — estimate the outer tx that will actually be broadcast (`multicall(bytes[])` when batching, or the single call otherwise).
- For Safe / Safe{Wallet} flows where `estimateGas` semantics differ (the wallet queues rather than executes), still attempt the preflight when the underlying RPC allows it; fall back gracefully when the wallet context makes preflight unreliable, but document the fallback inline.
- Never send a write without at least attempting the preflight. Skipping it is only acceptable when the wallet path provably does not support estimation, and that path must be explicit in code.

If you later discover an existing shared helper that already does this, route new code through that helper instead of duplicating the logic.

## 5. UI/UX — brand consistency

Any new visual element (component, layout, color, spacing, typography, icon, state) must match the existing brand and design system already present in the repo:

- Reuse existing components and Tailwind tokens before introducing new ones.
- Match existing spacing scale, radius, typography, and color usage — do not invent one-off styles.
- If a truly new visual pattern is required, mirror the closest existing pattern rather than importing an unrelated style.

## 6. Dependencies — strict versions + security check

When adding or upgrading a package:

1. Pin an exact version in `package.json`. No `^`, no `~`, no ranges. Match the style already used in the repo.
2. Before choosing the version, do a quick security check on X/Twitter for recent alerts about that package (supply-chain compromise, malicious release, hijacked maintainer, known-bad version). If a version is flagged, pick a safe earlier or later version.
3. Prefer versions already battle-tested by the community over the absolute latest release.

## 7. Architectural comments — only when it matters

Do NOT narrate code with obvious comments. DO leave a short comment when:

- The implementation relies on legacy code or a legacy API that could bite future changes.
- There is a non-obvious constraint, trade-off, or ordering requirement a future reader must respect.
- A workaround exists because of an upstream bug or limitation.

Keep such comments one or two lines, focused on the "why" and the future risk.

## 8. Quality gates — end of every task

Before declaring the task done, run and pass (in the `.nvmrc` Node version):

- `npm run lint` — zero warnings, zero errors (the script runs with `--max-warnings 0`).
- `npm run type-check` — clean.
- `npm run build` — clean.

If any gate fails, fix it before finishing. Do not hand off red builds.

## 9. Release / hotfix branches — version + CHANGELOG together

At the end of every task, update `CHANGELOG.md`. The rule depends on the current git branch.

First, determine the branch: `git rev-parse --abbrev-ref HEAD`.

### Case A — branch matches `release/*` or `hotfix/*`

On these branches you are shipping a version, so BOTH the version and the changelog must be updated together:

1. Bump the `version` field in [`package.json`](package.json) to the target release/hotfix version:
   - `release/*` → bump minor or major as appropriate (e.g. `0.10.0` → `0.11.0`).
   - `hotfix/*` → bump patch (e.g. `0.10.0` → `0.10.1`).
   - If the branch name encodes the version (e.g. `release/0.11.0`, `hotfix/0.10.1`), use exactly that version.
   - Any lockfile / manifest that mirrors this version (e.g. generated by the `prebuild` sync script) must stay consistent — let the existing `prebuild` step handle it and verify after build.
2. Create (or reuse if already present for today) a version section at the top of `CHANGELOG.md`, under the `# Changelog` header:
   - Format: `## [x.y.z] - YYYY-MM-DD`
   - Version: the NEW version you just wrote to `package.json`.
   - Date: today's date in `YYYY-MM-DD`.
3. Under that version, add a single-line entry in the correct category: `### Added`, `### Updated`, or `### Fixed`.

### Case B — any other branch

- Do NOT touch the `version` field in `package.json`.
- Put the entry under the existing `## [Unreleased]` section only.
- If `## [Unreleased]` does not exist yet, add it at the top (above the first versioned release).
- Add a single-line entry under the correct category: `### Added`, `### Updated`, or `### Fixed`.

### Entry rules (both cases)

- One line. Not a paragraph. No multi-sentence description.
- Choose the category by intent of the change:
  - `Added` — brand-new capability or feature.
  - `Updated` — improvement or change to existing behavior.
  - `Fixed` — bug fix or regression repair.
- Write it from the user's perspective when possible, not the implementation's.

## 10. Definition of done

A coding task is done only when ALL of the following are true:

- Code implements the request.
- RPC reads are batched per section 2 where applicable.
- Any new/extended ABI lives in a JSON file per section 3 (never hand-written in TS); if the ABI was missing, the user was asked whether the agent should generate the JSON or whether they will supply it.
- Every new on-chain write runs an `estimateGas` preflight per section 4 (revert → decoded message, success → gas reused for the send).
- New UI matches the brand per section 5.
- Any new dependency is pinned and security-checked per section 6.
- Non-obvious / legacy decisions have a short comment per section 7.
- Lint, type-check, and build are all clean per section 8.
- On `release/*` or `hotfix/*`: `package.json` version is bumped AND `CHANGELOG.md` has the matching versioned section with a one-line entry (section 9).
- On any other branch: `CHANGELOG.md` has a one-line entry under `## [Unreleased]` in the right category, and `package.json` version is unchanged (section 9).
