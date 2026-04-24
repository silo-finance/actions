import { getAddress } from 'ethers'
import type { EarnSiloEntry } from '@/utils/siloEarnSilosApi'
import { NETWORK_CONFIGS } from '@/utils/networks'

/**
 * Live snapshot from silo-contracts-v3 (fallback when `app.silo.finance/api/earn-silos` fails).
 * Override for staging via `NEXT_PUBLIC_SILO_DEPLOYMENTS_JSON_URL`.
 */
const DEFAULT_DEPLOYMENTS_JSON_URL =
  'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/master/silo-core/deploy/silo/_siloDeployments.json'

export function getSiloDeploymentsJsonUrl(): string {
  const raw =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SILO_DEPLOYMENTS_JSON_URL
      ? process.env.NEXT_PUBLIC_SILO_DEPLOYMENTS_JSON_URL.trim()
      : ''
  return (raw || DEFAULT_DEPLOYMENTS_JSON_URL).replace(/\/$/, '')
}

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
 * Heuristic — the JSON has no explicit symbol fields (copied from legacy `siloDeploymentsIndex`).
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

function tryChecksum(addr: string): string | null {
  try {
    return getAddress(addr)
  } catch {
    return null
  }
}

/**
 * V3 production markets for the picker: numeric id in key and `>= 3000` (matches former static list).
 */
function isV3MarketId(id: number | null): boolean {
  return id != null && id >= 3000
}

/**
 * Fetch SiloConfig addresses from the public contracts repo JSON and map to `EarnSiloEntry`.
 * Only includes V3 markets (`_id_` ≥ 3000). Chains with no bucket in the JSON return `[]`.
 */
export async function fetchSiloDeploymentsFromRepo(
  chainId: number,
  signal?: AbortSignal,
  jsonUrl: string = getSiloDeploymentsJsonUrl()
): Promise<EarnSiloEntry[]> {
  const res = await fetch(jsonUrl, { signal })
  if (!res.ok) {
    throw new Error(`silo-contracts deployments JSON HTTP ${res.status}`)
  }
  const source = (await res.json()) as RawDeployments

  const chainName = NETWORK_CONFIGS.find((c) => c.chainId === chainId)?.chainName
  if (!chainName) return []

  const markets = source[chainName]
  if (!markets || typeof markets !== 'object') return []

  const rows: Array<{ entry: EarnSiloEntry; rawKey: string }> = []

  for (const [rawKey, address] of Object.entries(markets)) {
    if (typeof address !== 'string') continue
    const siloConfig = tryChecksum(address)
    if (!siloConfig) continue

    const parsed = parseSiloDeploymentKey(rawKey)
    if (!isV3MarketId(parsed.id)) continue

    const tokenSymbol = parsed.symbol0 || null
    const collateralTokenSymbol = parsed.symbol1 || null
    const name = [tokenSymbol, collateralTokenSymbol].filter(Boolean).join('-') || rawKey

    rows.push({
      rawKey,
      entry: {
        chainId,
        siloConfig,
        siloId: parsed.id,
        silo: null,
        tokenAddress: null,
        tokenSymbol,
        collateralTokenAddress: null,
        collateralTokenSymbol,
        name,
        riskProfile: null,
      },
    })
  }

  rows.sort((a, b) => {
    const aId = a.entry.siloId ?? Number.POSITIVE_INFINITY
    const bId = b.entry.siloId ?? Number.POSITIVE_INFINITY
    if (aId !== bId) return aId - bId
    return a.rawKey.toLowerCase().localeCompare(b.rawKey.toLowerCase())
  })

  return rows.map((r) => r.entry)
}
