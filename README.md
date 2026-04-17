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

For WalletConnect on the deployed site, add a **repository variable** (not required for local-only extension wallets):

1. GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**
2. Name: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, value: your Reown / WalletConnect project id  
   The deploy workflow passes it into `npm run build` as `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.

### Post-deploy smoke test and automatic rollback

After each successful GitHub Pages deployment, the workflow runs a **Playwright** smoke test against the **vault** page deep link (mainnet VOLTS: `./vault/?chain=1&address=0x5362…`) so `https://org.github.io/repo` is not mistaken for site root. It checks that the **Vault** heading appears, the address field is prefilled from the URL, and fails on **uncaught page errors** or **`console.error`** (typical for serious React runtime problems). CI logs print the exact full URL under test.

If that smoke test fails, a follow-up job **dispatches the same workflow again** with:

- `ref` set to the previous commit on `master` when the deploy was triggered by a **push** (using `github.event.before`), or otherwise the **parent** of the commit that was actually deployed (`deployed_sha^`),
- `is_rollback` set to `true` so that a second failure does **not** trigger another rollback (avoids an infinite loop).

This is **one** rollback step, not a loop that walks older and older commits until something passes: we only go back **one** revision (previous branch tip on push, or parent of the deployed SHA otherwise). The new run performs deploy and smoke again; if smoke still fails, the workflow fails and **no further** auto-rollback runs because `is_rollback` is `true`.

The original workflow run still ends as **failed** so you can inspect logs; the rollback runs as a **new** workflow run. The `auto_rollback` job sets `permissions.actions: write` on `GITHUB_TOKEN` so it can call `workflow_dispatch`. If dispatch still fails, check **Settings** → **Actions** → **General** for any organization-level restrictions on the token.

**Manual rollback:** Actions → **Deploy to GitHub Pages** → **Run workflow**, set `ref` to a known-good tag or commit SHA. Leave `is_rollback` at `false` unless you are debugging the rollback path.

**Local smoke against any URL:**

```bash
SMOKE_BASE_URL=https://your-org.github.io/your-repo \
SMOKE_PAGE_PATH='./vault/?chain=1&address=0x5362D5086FDef73450145492a66F8EBF210c5B9C' \
npm run test:smoke
```

`SMOKE_PAGE_PATH` is optional; the default matches the vault URL used in Actions.

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

