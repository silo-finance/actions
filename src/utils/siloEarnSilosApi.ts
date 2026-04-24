import { getAddress } from 'ethers'
import { fetchSiloDeploymentsFromRepo } from '@/utils/siloDeploymentsRepo'
import { getNetworkDisplayName } from '@/utils/networks'
import { getSiloV3GraphqlUrl } from '@/utils/siloV3VaultsApi'

/**
 * Predefined silos for the Markets page picker.
 *
 * **Primary:** `POST https://app.silo.finance/api/earn-silos` (curated earn UI list). SiloConfig
 * only from `link`; dedupe by config; enrich `siloId` via v3 GraphQL (`configAddress` → `siloId`).
 *
 * **Fallback:** public raw JSON from silo-contracts-v3 (`_siloDeployments.json`) when the earn API
 * errors (e.g. HTTP 400). See `fetchSiloDeploymentsFromRepo` and `NEXT_PUBLIC_SILO_DEPLOYMENTS_JSON_URL`.
 *
 * **Local dev CORS on earn:** `npm run dev:proxy-earn-silos` + `NEXT_PUBLIC_EARN_SILOS_URL` in `.env.local`.
 */

export type EarnSiloEntry = {
  /** Supported `chainId` resolved from `chainKey` (see `CHAIN_KEY_BY_ID`). */
  chainId: number
  /** Checksummed SiloConfig — parsed from `link: "/markets/<chainKey>-<SILOCONFIG>"`. */
  siloConfig: string
  /**
   * On-chain numeric market id from the v3 indexer (`SILO_ID()`), matched by `configAddress`.
   * `null` when GraphQL failed or this config is not indexed yet.
   */
  siloId: number | null
  /**
   * Earn-side silo from REST `siloAddress` when present; informational only — we do not use it
   * to derive SiloConfig. The full pair is resolved on-chain after the user runs Check.
   */
  silo: string | null
  /** Earn-side token address (checksummed) — what the depositor supplies. */
  tokenAddress: string | null
  /** Earn-side token symbol (e.g. `USDC`). */
  tokenSymbol: string | null
  /** Other-side (collateral) token address (checksummed). */
  collateralTokenAddress: string | null
  /** Other-side token symbol (e.g. `wstETH`). */
  collateralTokenSymbol: string | null
  /** Human name used for sorting/filter: `tokenSymbol-collateralTokenSymbol`. */
  name: string
  /** `low` | `medium` | `high` | … — forwarded verbatim for future use. */
  riskProfile: string | null
}

/**
 * Mapping between our `chainId`s (see `src/utils/networks.ts`) and the `chainKey` slug the earn
 * endpoint uses. Keys for chains we support but have no known slug yet are omitted; such chains
 * simply return an empty list. Confirmed slugs as of 2026-04-23 by probing the API:
 * `ethereum`, `arbitrum`, `avalanche`, `injective`, `sonic`, `xdc`. The rest are best-effort.
 */
const CHAIN_KEY_BY_ID: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  50: 'xdc',
  56: 'bnb',
  146: 'sonic',
  196: 'okx',
  1776: 'injective',
  42161: 'arbitrum',
  43114: 'avalanche',
}
const CHAIN_ID_BY_KEY: Record<string, number> = Object.fromEntries(
  Object.entries(CHAIN_KEY_BY_ID).map(([id, key]) => [key, Number(id)])
)

export function getEarnChainKey(chainId: number): string | null {
  return CHAIN_KEY_BY_ID[chainId] ?? null
}

const EARN_SILOS_URL_DEFAULT = 'https://app.silo.finance/api/earn-silos'

/** Production URL or dev proxy (`NEXT_PUBLIC_EARN_SILOS_URL` in `.env.local`). */
export function getEarnSilosApiUrl(): string {
  const raw =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EARN_SILOS_URL
      ? process.env.NEXT_PUBLIC_EARN_SILOS_URL.trim()
      : ''
  return (raw || EARN_SILOS_URL_DEFAULT).replace(/\/$/, '')
}

type RawEarnSilo = {
  _tag?: string
  siloAddress?: string | null
  chainKey?: string | null
  link?: string | null
  tokenAddress?: string | null
  tokenSymbol?: string | null
  collateralTokenAddress?: string | null
  collateralTokenSymbol?: string | null
  riskProfile?: string | null
}

type RawResponse = {
  total?: number
  silos?: RawEarnSilo[]
}

function tryChecksum(addr: string | null | undefined): string | null {
  if (!addr) return null
  try {
    return getAddress(addr)
  } catch {
    return null
  }
}

/**
 * The earn endpoint encodes the SiloConfig inside `link`, shaped as
 * `/markets/<chainKey>-<0xSILOCONFIG>`. Anchored on the trailing hex so we don't misread future
 * path segments that happen to contain another address.
 */
function parseSiloConfigFromLink(link: string | null | undefined): string | null {
  if (!link) return null
  const match = /-(0x[a-fA-F0-9]{40})(?:[/?#].*)?$/.exec(link)
  return match ? tryChecksum(match[1]) : null
}

type DedupBucket = {
  chainId: number
  siloConfig: string
  silo: string | null
  tokenAddress: string | null
  tokenSymbol: string | null
  collateralTokenAddress: string | null
  collateralTokenSymbol: string | null
  riskProfile: string | null
}

function mergeEarnRowIntoBucket(bucket: DedupBucket, row: RawEarnSilo, chainId: number): void {
  const silo = tryChecksum(row.siloAddress)
  if (!bucket.silo && silo) bucket.silo = silo
  if (!bucket.tokenSymbol && row.tokenSymbol) bucket.tokenSymbol = row.tokenSymbol
  if (!bucket.collateralTokenSymbol && row.collateralTokenSymbol) {
    bucket.collateralTokenSymbol = row.collateralTokenSymbol
  }
  if (!bucket.tokenAddress) bucket.tokenAddress = tryChecksum(row.tokenAddress)
  if (!bucket.collateralTokenAddress) {
    bucket.collateralTokenAddress = tryChecksum(row.collateralTokenAddress)
  }
  if (!bucket.riskProfile && row.riskProfile) bucket.riskProfile = row.riskProfile
  bucket.chainId = chainId
}

/**
 * Ponder returns `INTERNAL_SERVER_ERROR` for large `silos(limit: …)` values (see history: 1500+).
 * We keep a conservative page size; if a chain ever has more indexed silos than one page, we
 * advance `offset` (unlikely to exceed ~200 markets per chain in practice).
 */
const SILO_ID_PAGE_SIZE = 200

const SILO_ID_BY_CONFIG_QUERY = `
query siloIdsByChain($chainId: Int!, $limit: Int!, $offset: Int!) {
  silos(limit: $limit, offset: $offset, where: { chainId: $chainId }) {
    items {
      siloId
      configAddress
    }
  }
}
`

type GraphqlSiloIdResponse = {
  data?: { silos?: { items?: Array<{ siloId: string | null; configAddress: string | null }> } }
  errors?: Array<{ message?: string }>
}

/**
 * `configAddress` (lowercase key) → numeric `siloId` from the indexer (matches on-chain `SILO_ID()`).
 */
async function fetchSiloIdByConfigAddress(
  chainId: number,
  signal: AbortSignal | undefined,
  graphqlUrl: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  let offset = 0

  for (;;) {
    const res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: SILO_ID_BY_CONFIG_QUERY,
        variables: {
          chainId,
          limit: SILO_ID_PAGE_SIZE,
          offset,
        },
      }),
      signal,
    })
    if (!res.ok) {
      throw new Error(`Silo v3 GraphQL HTTP ${res.status}`)
    }
    const json = (await res.json()) as GraphqlSiloIdResponse
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message ?? '').filter(Boolean).join('; ')
      throw new Error(msg || 'Silo v3 GraphQL error')
    }
    const items = json.data?.silos?.items ?? []
    for (const item of items) {
      if (!item.configAddress || item.siloId == null) continue
      const cfg = tryChecksum(item.configAddress)
      if (!cfg) continue
      const n = Number(item.siloId)
      if (!Number.isFinite(n) || !Number.isInteger(n)) continue
      map.set(cfg.toLowerCase(), n)
    }
    if (items.length < SILO_ID_PAGE_SIZE) break
    offset += SILO_ID_PAGE_SIZE
  }

  return map
}

async function fetchEarnSilosFromApi(
  chainId: number,
  signal?: AbortSignal,
  endpoint: string = getEarnSilosApiUrl(),
  graphqlUrl: string = getSiloV3GraphqlUrl()
): Promise<EarnSiloEntry[]> {
  const chainKey = CHAIN_KEY_BY_ID[chainId]
  const body = {
    siloIds: [],
    search: null,
    riskProfiles: [],
    /**
     * Server-side chain filter when we know the slug; empty array fetches every chain and we
     * filter client-side. Either way we defensively re-filter below in case the server ignores
     * this field.
     */
    chainKeys: chainKey ? [chainKey] : [],
    minTotalSupplyUsd: null,
    sort: null,
    limit: 200,
    offset: 0,
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    throw new Error(`earn-silos HTTP ${res.status}`)
  }

  const json = (await res.json()) as RawResponse
  const rows = json.silos ?? []

  /** Unique SiloConfig (lowercase key) — derived only from `link`, never from `siloAddress`. */
  const byConfig = new Map<string, DedupBucket>()

  for (const row of rows) {
    const rowChainId = row.chainKey ? CHAIN_ID_BY_KEY[row.chainKey] : undefined
    if (typeof rowChainId !== 'number' || rowChainId !== chainId) continue

    const siloConfig = parseSiloConfigFromLink(row.link)
    if (!siloConfig) continue

    const key = siloConfig.toLowerCase()
    const tokenSymbol = row.tokenSymbol ?? null
    const collateralTokenSymbol = row.collateralTokenSymbol ?? null

    const existing = byConfig.get(key)
    if (!existing) {
      byConfig.set(key, {
        chainId,
        siloConfig,
        silo: tryChecksum(row.siloAddress),
        tokenAddress: tryChecksum(row.tokenAddress),
        tokenSymbol,
        collateralTokenAddress: tryChecksum(row.collateralTokenAddress),
        collateralTokenSymbol,
        riskProfile: row.riskProfile ?? null,
      })
    } else {
      mergeEarnRowIntoBucket(existing, row, chainId)
    }
  }

  let idByConfig = new Map<string, number>()
  try {
    idByConfig = await fetchSiloIdByConfigAddress(chainId, signal, graphqlUrl)
  } catch {
    /** Picker still works from earn symbols; `#id` is omitted if GraphQL is down. */
  }

  const out: EarnSiloEntry[] = []
  for (const b of Array.from(byConfig.values())) {
    const tokenSymbol = b.tokenSymbol ?? null
    const collateralTokenSymbol = b.collateralTokenSymbol ?? null
    const name = [tokenSymbol, collateralTokenSymbol].filter(Boolean).join('-') || b.siloConfig
    out.push({
      chainId: b.chainId,
      siloConfig: b.siloConfig,
      siloId: idByConfig.get(b.siloConfig.toLowerCase()) ?? null,
      silo: b.silo,
      tokenAddress: b.tokenAddress,
      tokenSymbol,
      collateralTokenAddress: b.collateralTokenAddress,
      collateralTokenSymbol,
      name,
      riskProfile: b.riskProfile,
    })
  }

  out.sort((a, b) => {
    if (a.siloId != null && b.siloId != null && a.siloId !== b.siloId) return a.siloId - b.siloId
    if (a.siloId != null && b.siloId == null) return -1
    if (a.siloId == null && b.siloId != null) return 1
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })

  return out
}

export type PredefinedSilosResult = {
  entries: EarnSiloEntry[]
  /** Set when the earn API failed but the contracts-repo JSON succeeded. */
  apiWarning: string | null
}

/**
 * Load predefined silos: try earn API first; on any failure, fall back to `_siloDeployments.json`
 * from silo-contracts-v3 (see `fetchSiloDeploymentsFromRepo`). Throws only if both fail.
 */
export async function fetchPredefinedSilosForChain(
  chainId: number,
  signal?: AbortSignal
): Promise<PredefinedSilosResult> {
  try {
    const entries = await fetchEarnSilosFromApi(chainId, signal)
    return { entries, apiWarning: null }
  } catch (apiErr) {
    const net = getNetworkDisplayName(chainId) ?? `chain ${chainId}`
    const detail = apiErr instanceof Error ? apiErr.message : String(apiErr)
    try {
      const entries = await fetchSiloDeploymentsFromRepo(chainId, signal)
      return {
        entries,
        apiWarning: `Earn API failed for ${net} (${detail}), fallback to silo repository`,
      }
    } catch (repoErr) {
      const repoDetail = repoErr instanceof Error ? repoErr.message : String(repoErr)
      throw new Error(
        `Predefined silos: earn API failed (${detail}); contracts JSON failed (${repoDetail}).`
      )
    }
  }
}
