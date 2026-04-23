/**
 * Predefined SiloConfig deployments sourced from silo-contracts-v3.
 *
 * Snapshot of https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/master/silo-core/deploy/silo/_siloDeployments.json
 * Top-level keys are the `chainName` used in our `NETWORK_CONFIGS` (mainnet / arbitrum_one / avalanche / sonic / ...),
 * so the mapping is 1:1; chains in the JSON that we do not support (e.g. `ink`) get dropped silently.
 *
 * The value for every entry is a `SiloConfig` address (never a `Silo`) — `resolveSiloInput` still
 * validates on-chain before the page trusts it.
 */
import { NETWORK_CONFIGS } from '@/utils/networks'
import rawDeployments from '@/config/siloDeployments.json'

export type SiloDeploymentEntry = {
  /** Raw key from the JSON (e.g. `Silo_ARB_USDC_V2`), kept for tooltips and debugging. */
  rawKey: string
  siloConfig: `0x${string}`
  /** Best-effort parsed left-side asset symbol. */
  symbol0: string
  /** Best-effort parsed right-side asset symbol, or `null` when the key doesn't split cleanly. */
  symbol1: string | null
  /**
   * Market id parsed from the `_id_<N>` suffix in the key, or `null` when there is no id.
   * Classifies V3 (>= 3000) vs V2 (everything else).
   */
  id: number | null
  /** `true` when `rawKey` starts with `Test_` (test deployments still appear in the JSON). */
  isTest: boolean
}

const CHAIN_NAME_TO_ID: ReadonlyMap<string, number> = new Map(
  NETWORK_CONFIGS.map((c) => [c.chainName, c.chainId])
)

/** Suffix tags that do not belong to the asset pair and must be stripped before splitting. */
const NON_PAIR_SUFFIX_PATTERNS: readonly RegExp[] = [
  /_[Vv]\d+$/,
  /_borrowable(_[A-Za-z0-9]+)?$/,
  /_external(_\d+)?$/,
  /_lower_ir$/,
  /_shareToken18Decimals$/,
  /_KinkIRM$/,
  /_Silo$/,
  /_\d+$/,
]

/**
 * Extract `{ symbol0, symbol1, id }` from a name like `Silo_GM_BTC_USDC_id_3006`.
 *
 * Heuristic — the JSON has no explicit fields:
 *   1. Strip `Silo_` / `Test_Silo_` (case-insensitive) prefix.
 *   2. Peel `_id_<N>` suffix → `id`.
 *   3. Loop-strip known non-pair suffix tags (`_V2`, `_borrowable`, `_external`, `_2`, ...).
 *   4. Split on the LAST underscore → `symbol0` / `symbol1` (so compound left-side names like
 *      `GM_BTC` or `ARM-WETH-stETH` stay in `symbol0`).
 * Edge names with weird date-underscores still produce something human-readable — not perfect,
 * but always clickable, and the raw key stays on the button's `title` for inspection.
 */
export function parseSiloDeploymentKey(rawKey: string): {
  symbol0: string
  symbol1: string | null
  id: number | null
  isTest: boolean
} {
  const isTest = /^Test_/i.test(rawKey)
  let s = rawKey.replace(/^Test_Silo_/i, '').replace(/^Silo_/i, '')

  let id: number | null = null
  const idMatch = s.match(/_id_(\d+)$/)
  if (idMatch) {
    id = parseInt(idMatch[1], 10)
    s = s.slice(0, idMatch.index)
  }

  /** Loop until no suffix matches so stacked tags like `_borrowable_2` collapse in one pass. */
  let changed = true
  while (changed) {
    changed = false
    for (const p of NON_PAIR_SUFFIX_PATTERNS) {
      if (p.test(s)) {
        s = s.replace(p, '')
        changed = true
      }
    }
  }

  const lastUnderscore = s.lastIndexOf('_')
  if (lastUnderscore === -1) {
    return { symbol0: s || rawKey, symbol1: null, id, isTest }
  }
  const symbol0 = s.slice(0, lastUnderscore)
  const symbol1 = s.slice(lastUnderscore + 1)
  return { symbol0: symbol0 || rawKey, symbol1: symbol1 || null, id, isTest }
}

type RawDeployments = Record<string, Record<string, string>>

const ENTRIES_BY_CHAIN_ID: ReadonlyMap<number, readonly SiloDeploymentEntry[]> = (() => {
  const source = rawDeployments as RawDeployments
  const byChain = new Map<number, SiloDeploymentEntry[]>()
  for (const [chainName, markets] of Object.entries(source)) {
    const chainId = CHAIN_NAME_TO_ID.get(chainName)
    if (chainId == null) continue
    const rows: SiloDeploymentEntry[] = []
    for (const [rawKey, address] of Object.entries(markets)) {
      const parsed = parseSiloDeploymentKey(rawKey)
      rows.push({
        rawKey,
        siloConfig: address as `0x${string}`,
        symbol0: parsed.symbol0,
        symbol1: parsed.symbol1,
        id: parsed.id,
        isTest: parsed.isTest,
      })
    }
    byChain.set(chainId, rows)
  }
  return byChain
})()

/**
 * All predefined SiloConfig deployments for the given chain, sorted deterministically:
 *   1. id ascending (entries without an id last),
 *   2. then raw key alphabetically, case-insensitive — stable on re-renders.
 */
export function getSiloDeploymentsForChain(chainId: number): readonly SiloDeploymentEntry[] {
  const rows = ENTRIES_BY_CHAIN_ID.get(chainId)
  if (!rows || rows.length === 0) return []
  return [...rows].sort((a, b) => {
    const aId = a.id ?? Number.POSITIVE_INFINITY
    const bId = b.id ?? Number.POSITIVE_INFINITY
    if (aId !== bId) return aId - bId
    return a.rawKey.toLowerCase().localeCompare(b.rawKey.toLowerCase())
  })
}

export type SiloDeploymentsGrouped = {
  v3: readonly SiloDeploymentEntry[]
  v2: readonly SiloDeploymentEntry[]
}

/**
 * V3 = entries with `id >= 3000`. Everything else (explicit lower id OR missing id) is V2.
 * Groups preserve the deterministic order from `getSiloDeploymentsForChain`.
 */
export function groupSiloDeployments(
  entries: readonly SiloDeploymentEntry[]
): SiloDeploymentsGrouped {
  const v3: SiloDeploymentEntry[] = []
  const v2: SiloDeploymentEntry[] = []
  for (const row of entries) {
    if (row.id != null && row.id >= 3000) v3.push(row)
    else v2.push(row)
  }
  return { v3, v2 }
}
