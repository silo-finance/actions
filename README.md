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

