# Silo Actions

UI boilerplate for quick actions.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

GitHub Pages deployment is configured in `.github/workflows/deploy-pages.yml`.

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

### Remove a market from the withdraw queue (curator / Safe flow)

The in-app flow **Reallocate & remove from withdraw queue** builds a **single Safe proposal** to the vault. Depending on on-chain state and your choices, the vault executes up to **four** methods (in this order; several are often batched as one `multicall` on the vault):

1. **`reallocate`** — `_allocations` (`MarketAllocation[]`): withdraw the vault’s full position from the market you remove (`assets == 0` on that market), then supply into one or more destination markets (encoding uses `type(uint256).max` on destination steps; caps and **headroom** `cap − current balance` are validated in the UI).
2. **`submitCap`** — `_market` (address of the removed market), `_newSupplyCap` **`0`**. Included only when that market’s cap is currently greater than zero (lowering cap applies immediately on SiloVault).
3. **`updateWithdrawQueue`** — **`_indexes`** (`uint256[]`): permutation of **previous** withdraw-queue indices with the removed index dropped (same ordering logic the app shows in the proposal preview).
4. **`setSupplyQueue`** — **`_newSupplyQueue`** (`address[]`): current supply queue with the removed market omitted; order of the remaining markets unchanged. **Optional**: only if you tick “Also remove this market from the supply queue” in the wizard and the market appears in the supply queue.

If there is **no** liquidity to move and **no** cap to zero and **no** supply-queue change, the proposal may be a **direct** `updateWithdrawQueue` call only (no `multicall`).

In the wizard, each step shows **the method name and argument types** on the first line, and **copyable values only** below (no method prefix). For **`reallocate`**, the copied value is **valid JSON**: an array of two-element arrays, addresses and uint256s **both in double quotes**, e.g. `[["0x…","0"],["0x…","115792089237316195423570985008687907853269984665640564039457584007913129639935"]]`. Other steps copy as `0x…, 0` for **`submitCap`**, `[0,1,2]` for **`updateWithdrawQueue`**, and `[0x…,0x…]` for **`setSupplyQueue`**.

---

