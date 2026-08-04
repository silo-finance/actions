# Silo Actions

UI boilerplate for quick actions.

## Run locally

```bash
npm install
npm run dev
```

### Wallet connection

The app uses [wagmi](https://wagmi.sh/) with an **injected** connector (browser extension wallets) and optional **WalletConnect**.

To enable WalletConnect (mobile / QR), create a project at [WalletConnect Cloud](https://cloud.walletconnect.com/) and set:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

Without this variable, **Browser extension** still works; the WalletConnect option will prompt you to configure the project id.

## Production build

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`.

## Positions dashboard snapshot

The `Positions` page **always** loads market metadata at runtime from the `legacy-positions` data branch (same branch as legacy borrower/position JSON). There is **no** bundled fallback: if the remote fetch fails, Positions shows an error.

**Required build / local env** (repository variable for GitHub Pages deploy):

```bash
# Raw GitHub base ending at …/src/data/silos (no trailing file name)
NEXT_PUBLIC_LIQ_SILOS_BASE_URL=https://raw.githubusercontent.com/silo-finance/actions/refs/heads/legacy-positions/src/data/silos
```

Optional per-chain overrides: `NEXT_PUBLIC_LIQ_SILOS_URL_ETHEREUM`, `_ARBITRUM`, `_AVALANCHE`, `_INJECTIVE`, `_SONIC`, `_XDC`.

Fetches use `cache: 'no-store'` plus a cache-bust query param (same idea as legacy positions) so CDN/browser do not serve stale snapshots after Refresh pushes.

**V3 membership:** Refresh V3 Silos runs like Pull Legacy Positions: scripts/blacklist from `master` by default (`source_ref`), then **pushes only** `src/data/silos/{chain}.json` to the shared data branch `legacy-positions` (never to a feature/PR branch). Membership = GraphQL `markets` with `siloId >= 3000` minus `src/data/silos/blacklist/` on `master`. Legacy rows already in a snapshot are preserved. Blacklist / legacy whitelist changes still land on `master` via PR.

**Bootstrap order:** publish silo JSON onto `legacy-positions` first (run Refresh V3 Silos once), set `NEXT_PUBLIC_LIQ_SILOS_BASE_URL`, then deploy the app. Deploying the fetch-capable build before the data branch has files shows the Positions error UI until the branch is populated.

Snapshot maintenance is CI-driven:

- `.github/workflows/refresh-v3-silos.yml` — GraphQL v3 − blacklist (+ preserve legacy); hourly cron + manual; pushes silos to `legacy-positions`
- `.github/workflows/add-any-silo.yml` — refresh one address; clears blacklist when present; publishes silos to data branch; PR for blacklist/whitelist on `master`
- `.github/workflows/remove-any-silo.yml` — remove one address; v3 also appends to blacklist; publishes silos; PR for blacklist/whitelist
- `.github/workflows/blacklist-silos.yml` — batch paste JSON from the Positions UI; publishes silos; PR for blacklist/whitelist

Local sync commands still write `src/data/silos/*.json` in the working tree (for scripts/CI); that does **not** feed the UI unless published to `legacy-positions`:

```bash
node scripts/sync-liquidation-silos.mjs full
node scripts/sync-liquidation-silos.mjs add --chainKey=arbitrum --siloAddress=0x...
node scripts/sync-liquidation-silos.mjs remove --chainKey=arbitrum --siloAddress=0x...
node scripts/sync-liquidation-silos.mjs blacklist --config='{"markets":[{"chainKey":"arbitrum","siloAddress":"0x..."}]}'
```

Optional runtime envs for dashboard testing:

```bash
NEXT_PUBLIC_LIQ_GRAPHQL_URL=https://api-v3.silo.finance/graphql
# Local/dev slice only — filters the remote snapshot in the browser; not the durable sync blacklist
NEXT_PUBLIC_TEST_SILO_IDS=0x...,0x...
NEXT_PUBLIC_TEST_API_LIMIT=20
NEXT_PUBLIC_TEST_GRAPH_LIMIT=50
NEXT_PUBLIC_TEST_DISABLE_PAGINATION=true
NEXT_PUBLIC_RPC_ETHEREUM=https://ethereum.publicnode.com
NEXT_PUBLIC_RPC_ARBITRUM=https://arb1.arbitrum.io/rpc
NEXT_PUBLIC_RPC_AVALANCHE=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_RPC_INJECTIVE=https://sentry.evm-rpc.injective.network
NEXT_PUBLIC_RPC_SONIC=https://rpc.soniclabs.com
NEXT_PUBLIC_RPC_XDC=https://rpc.xdcrpc.com
```

> RPC endpoints are public by design on the deployed site: `NEXT_PUBLIC_RPC_*` is inlined into the static browser bundle at build time, so only ever point it at a public RPC (or rely on the hardcoded public defaults / the connected wallet's RPC). The deploy build does not pass any RPC var.

For a **private** RPC used **only by CI scripts** (legacy positions pull and silo sync), add a **repository secret** named `RPC_URL_<CHAIN>` (e.g. `RPC_URL_ETHEREUM`):

1. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Secrets** → **New repository secret**
2. Name: `RPC_URL_ETHEREUM` (and/or `RPC_URL_ARBITRUM`, `RPC_URL_AVALANCHE`, `RPC_URL_SONIC`, `RPC_URL_XDC`, `RPC_URL_INJECTIVE`), value: your private RPC URL

CI scripts prefer `RPC_URL_<CHAIN>`, then fall back to `NEXT_PUBLIC_RPC_<CHAIN>` (local `.env` only), then the hardcoded public default. These secrets are passed only to script steps, never to `npm run build`, so they stay out of the published bundle. Sync GraphQL URL can be overridden with `LIQ_GRAPHQL_URL` / `NEXT_PUBLIC_LIQ_GRAPHQL_URL`.

For WalletConnect on the deployed site, add a **repository variable** (not required for local-only extension wallets):

1. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**
2. Name: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, value: your Reown / WalletConnect project id  
   The deploy workflow passes it into `npm run build` as `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

### Post-deploy smoke test

After `actions/deploy-pages` publishes the site in the `deploy` job, a separate `post_deploy_smoke` job runs the **Playwright** smoke test against the **vault** deep link (full URL example: `https://org.github.io/repo/vault/?chain=1&address=0x5362…`). The test resolves the repo-relative path `./vault/?...` with `SMOKE_BASE_URL` into an absolute URL (Playwright does not reliably combine `./…` with `use.baseURL` alone). It checks that the **Vault** heading appears, the address field is prefilled from the URL, and fails on **uncaught page errors**, **tab crashes**, or **`console.error`**.

The `post_deploy_smoke` job runs **only** after a successful **`deploy`** (`if: success()`), so smoke is skipped solely when the first deployment job failed (nothing to verify). The job **fails** (red) when smoke does not pass. GitHub **skips** normal dependents of a failed job, so **`rollback_pages` must not depend on a bridge job** that also `needs` the failed smoke job. `rollback_pages` depends only on **`deploy` + `post_deploy_smoke`** and uses **`if: always()`** (no compound expression on `needs.post_deploy_smoke.result` — that pattern can leave the job **skipped** when smoke is red). The first step in `rollback_pages` decides whether to actually redeploy (smoke failed/cancelled + `rollback_eligible`). A `smoke_gate` job checks smoke success, or that **`rollback_ran`** was true after a failed smoke. When the gate passes, `finalize_deployment` prints an `OK` marker.

#### Automatic rollback (always to a semver tag)

GitHub Pages does **not** provide a native “revert this deployment” API after a bad publish. Rollback runs when smoke fails **and** the deploy is rollback-eligible: **published Release**, ref **`vX.Y.Z`** / **`X.Y.Z`**, any configured **`push`** run (this workflow uses `master`), or **`workflow_dispatch`** targeting the default branch / `master`. Tags are ordered by **creation time** and can be either **`X.Y.Z`** or **`vX.Y.Z`** (`git tag -l 'v*.*.*' '[0-9]*.[0-9]*.[0-9]*' --sort=-creatordate`). If the failed deploy was **from a tag**, the workflow redeploys the **chronologically previous** tag in that list. If the failed deploy was **from a branch ref**, it also redeploys the **previous** tag in that chronological list (the second entry; requires at least two tags). There is **no second Playwright run** after rollback.

The Safe app **`public/manifest.json`** includes a **`version`** field (same semver as `package.json`, without a `v` prefix). `npm run build` runs **`prebuild`** first (`scripts/sync-manifest-version.mjs`) so the built site always ships an up-to-date manifest. The PR automation script [`scripts/update-changelog-from-pr.mjs`](scripts/update-changelog-from-pr.mjs) also keeps that field aligned when it bumps `package.json` / `CHANGELOG.md` on `release/*` and `hotfix/*` branches.

After rollback deploy, the workflow **curl**s `https://…/repo/manifest.json` (with retries), reads **`version`** with `jq`, and prints it in the job log; if the file is not reachable yet, it logs a **warning** only.

Other **feature branches** (not the default branch) are not rollback-eligible unless you add them to `on` and extend the workflow. If rollback fails (no tags, or tag deploy with no earlier tag), fix forward or redeploy manually.

**Local smoke against any URL** (install browsers once: `npx playwright install`):

```bash
SMOKE_BASE_URL=https://your-org.github.io/your-repo \
SMOKE_PAGE_PATH='./vault/?chain=1&address=0x5362D5086FDef73450145492a66F8EBF210c5B9C' \
npm run test:smoke
```

`SMOKE_PAGE_PATH` is optional; the default matches the vault URL used in Actions.

For local runs, `SMOKE_BASE_URL` and `SMOKE_PAGE_PATH` can live in **`.env.local`** (same as Next.js). `playwright.config.ts` loads those files via `@next/env` before tests run. In CI, the workflow sets `SMOKE_BASE_URL` explicitly on the job.

## Manual actions (when the app UI is unavailable)

Step-by-step instructions for doing the same thing inside a multisig UI (e.g. Safe{Wallet}). No deep technical background—only what to click and what to paste.

---

### Clear the supply queue (`setSupplyQueue` — empty queue)

**Option A — pick the method (contract interaction)**

1. In **Contract address** / **To**, paste the **vault contract address**
3. When methods are listed, choose **`setSupplyQueue`**.
4. For the **`_newSupplyQueue`** argument (address list), enter exactly **`[]`**

**Option B — raw calldata only (no method picker)**

1. Create a transaction whose **destination address** is the **vault address**
2. Use **raw data** / **hex** / **custom calldata** (wording depends on the Safe version).
3. Paste the **full** string below (one line, including the `0x` prefix):

   ```
0x4e083eb300000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000
   ```

---

### Remove a market from the withdraw queue and reallocate

1. **`reallocate`** — `_allocations` (`MarketAllocation[]`): pull the vault’s liquidity **from** the market you are removing, and supply it **into** destination market(s). On the **source** (the market you remove), `assets` must be **`0`** (full exit). On each **destination**, `assets` is **`type(uint256).max`** so the vault supplies everything it just withdrew (order and headroom matter on-chain).

   **Example (exactly two markets — one “from”, one “to”):**  
   - **From** = market you empty (`0xFrom…`).  
   - **To** = market that receives the liquidity (`0xTo…`).  
   - Paste as JSON (both tuple values quoted), one line:

   ```
   [["0x1111111111111111111111111111111111111111","0"],["0x2222222222222222222222222222222222222222","115792089237316195423570985008687907853269984665640564039457584007913129639935"]]
   ```

2. **`submitCap`** — `_market` (address), `_newSupplyCap` (`uint256`). Only when that market’s cap is **&gt; 0** before the change; new cap is **0**.

   **Example:** `_market` = `0x1111111111111111111111111111111111111111` (the same market you are removing), `_newSupplyCap` = `0`.  

3. **`updateWithdrawQueue`** — `_indexes` (`uint256[]`): indices into the **previous** withdraw queue, in order, **without** the removed index.

   **Example:** withdraw queue had **4** markets at indices `0,1,2,3` and you remove index **2**. New permutation: `[0, 1, 3]`.  

4. **`setSupplyQueue`** — `_newSupplyQueue` (`address[]`): supply queue addresses **after** dropping the removed market; **relative order** of the rest unchanged. **Optional** (wizard checkbox).

   **Example:** supply queue was `[0xA…, 0xB…, 0xC…]` and you remove `0xB…`. New queue: `[0xA…, 0xC…]`.  
   Copy-paste: `[0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,0xcccccccccccccccccccccccccccccccccccccccc]`

---

