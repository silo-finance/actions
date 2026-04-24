import { getAddress } from 'ethers'

/**
 * Predefined list of earn markets for the current chain.
 *
 * History of sources considered:
 *   1. `https://github.com/silo-finance/silo-contracts-v3/blob/master/silo-core/deploy/silo/_siloDeployments.json`
 *      — static snapshot, stale quickly, no symbols or TVL.
 *   2. `https://api-v3.silo.finance/graphql` — CORS-friendly, rich (numeric `siloId`, both silos,
 *      both symbols), but returns every indexed silo rather than the curated earn-app list.
 *   3. `POST https://app.silo.finance/api/earn-silos` (current) — same feed the live earn UI at
 *      `app.silo.finance` renders, so the picker stays in lockstep with it. Returns one entry per
 *      market (the "earn side" silo) with both token symbols + addresses; the paired silo address
 *      and the numeric `SILO_ID()` still need on-chain reads for details.
 *
 * If this endpoint disappears or starts failing CORS from the static host, the GraphQL indexer
 * (option 2) is the drop-in fallback — that client lived in git history until 2026-04-23.
 *
 * **Local dev without upstream CORS:** run `npm run dev:proxy-earn-silos` in a second terminal and
 * put `NEXT_PUBLIC_EARN_SILOS_URL=http://127.0.0.1:3041/api/earn-silos` in `.env.local` (see
 * `scripts/earn-silos-dev-proxy.mjs`). Production stays on `https://app.silo.finance/...` once
 * `Access-Control-Allow-Origin` is deployed there.
 */

export type EarnSiloEntry = {
  /** Supported `chainId` resolved from `chainKey` (see `CHAIN_KEY_BY_ID`). */
  chainId: number
  /** Checksummed SiloConfig — parsed from `link: "/markets/<chainKey>-<SILOCONFIG>"`. */
  siloConfig: string
  /** Checksummed address of the earn-side silo. The paired silo is resolved on-chain later. */
  silo: string
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

export async function fetchEarnSilosForChain(
  chainId: number,
  signal?: AbortSignal,
  endpoint: string = getEarnSilosApiUrl()
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
    limit: 100,
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

  const out: EarnSiloEntry[] = []
  for (const row of rows) {
    const rowChainId = row.chainKey ? CHAIN_ID_BY_KEY[row.chainKey] : undefined
    const effectiveChainId = typeof rowChainId === 'number' ? rowChainId : null
    if (effectiveChainId !== chainId) continue

    const siloConfig = parseSiloConfigFromLink(row.link)
    const silo = tryChecksum(row.siloAddress)
    if (!siloConfig || !silo) continue

    const tokenSymbol = row.tokenSymbol ?? null
    const collateralTokenSymbol = row.collateralTokenSymbol ?? null
    const name = [tokenSymbol, collateralTokenSymbol].filter(Boolean).join('-') || siloConfig

    out.push({
      chainId: effectiveChainId,
      siloConfig,
      silo,
      tokenAddress: tryChecksum(row.tokenAddress),
      tokenSymbol,
      collateralTokenAddress: tryChecksum(row.collateralTokenAddress),
      collateralTokenSymbol,
      name,
      riskProfile: row.riskProfile ?? null,
    })
  }

  return out
}
