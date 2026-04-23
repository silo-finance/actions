import { getAddress } from 'ethers'
import { getSiloV3GraphqlUrl } from '@/utils/siloV3VaultsApi'

/**
 * Predefined list of SiloConfig markets for the current chain.
 *
 * Previously sourced from a static snapshot of
 * https://github.com/silo-finance/silo-contracts-v3/blob/master/silo-core/deploy/silo/_siloDeployments.json
 * committed at `src/config/siloDeployments.json`. `POST https://app.silo.finance/api/earn-silos`
 * was also considered (matches the `app.silo.finance` earn page) but that endpoint does not set
 * `Access-Control-Allow-Origin`, so it cannot be called directly from our static GitHub Pages
 * build — it would require a backend proxy we don't ship.
 *
 * The public Silo v3 GraphQL indexer (already used by the vault page) is CORS-enabled and returns
 * the extra fields we want: the numeric `siloId`, both asset symbols, and each per-silo market
 * address — so the picker can render `symbol0/symbol1 #id` for live deployments without any
 * on-chain round-trip, and the downstream reader can skip ERC20.`symbol()` when it comes from
 * here. If we ever need to fall back, the JSON snapshot URL above is the canonical source.
 */

export type EarnSiloEntry = {
  chainId: number
  /** Checksummed `SiloConfig` address — what the input field below the picker accepts. */
  siloConfig: string
  /** Numeric market id from `SILO_ID()` (`null` when the indexer has no value yet). */
  siloId: number | null
  /** Human-readable market name, e.g. `"wstETH-WETH"`. */
  name: string
  /** `asset1.symbol` — maps to silo at `index 0` returned by `SiloConfig.getSilos()`. */
  symbol0: string | null
  /** `asset2.symbol` — maps to silo at `index 1`. */
  symbol1: string | null
  /** Checksummed silo address for index 0. */
  silo0: string
  /** Checksummed silo address for index 1. */
  silo1: string
}

const SILOS_BY_CHAIN_QUERY = `
query silosByChain($chainId: Int!, $limit: Int!) {
  silos(limit: $limit, where: { chainId: $chainId }) {
    items {
      id
      chainId
      siloId
      configAddress
      name
      market1 { id index }
      market2 { id index }
      asset1 { symbol }
      asset2 { symbol }
    }
  }
}
`

type RawSilo = {
  id: string
  chainId: number
  /** BigInt serialized as a decimal string. */
  siloId: string | null
  configAddress: string | null
  name: string | null
  market1: { id: string; index: number } | null
  market2: { id: string; index: number } | null
  asset1: { symbol: string | null } | null
  asset2: { symbol: string | null } | null
}

type GraphqlSilosResponse = {
  data?: { silos?: { items?: RawSilo[] } }
  errors?: Array<{ message?: string }>
}

function tryChecksum(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    return getAddress(address)
  } catch {
    return null
  }
}

/**
 * Fetches every silo indexed for `chainId`. The indexer caps at `limit` items; 1000 leaves
 * plenty of headroom (mainnet currently < 100 V3 markets) while staying within a single request.
 */
export async function fetchEarnSilosForChain(
  chainId: number,
  signal?: AbortSignal,
  graphqlUrl: string = getSiloV3GraphqlUrl()
): Promise<EarnSiloEntry[]> {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: SILOS_BY_CHAIN_QUERY,
      variables: { chainId, limit: 1000 },
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Silo v3 GraphQL HTTP ${res.status}`)
  }

  const json = (await res.json()) as GraphqlSilosResponse
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message ?? '').filter(Boolean).join('; ')
    throw new Error(msg || 'Silo v3 GraphQL error')
  }

  const rows = json.data?.silos?.items ?? []
  const out: EarnSiloEntry[] = []
  for (const row of rows) {
    const siloConfig = tryChecksum(row.configAddress ?? row.id)
    const silo0 = tryChecksum(row.market1?.id)
    const silo1 = tryChecksum(row.market2?.id)
    if (!siloConfig || !silo0 || !silo1) continue

    /**
     * `siloId` arrives as a BigInt-as-string. We only render it and use it for a V3 filter
     * (`>= 3000`), both comfortably in JS's safe-integer range today, so `Number(...)` is fine.
     */
    let siloIdNum: number | null = null
    if (row.siloId != null) {
      const n = Number(row.siloId)
      if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) siloIdNum = n
    }

    out.push({
      chainId: typeof row.chainId === 'number' ? row.chainId : chainId,
      siloConfig,
      siloId: siloIdNum,
      name: row.name ?? '',
      symbol0: row.asset1?.symbol ?? null,
      symbol1: row.asset2?.symbol ?? null,
      silo0,
      silo1,
    })
  }

  return out
}
