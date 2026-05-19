import { buildLiquidationPositionKey } from '@/utils/liquidationPositionIdentity'

export type ExternalPositionRecord = {
  chainId: number
  accountId: string
  marketId: string
  ltv: string | null
  debtValue: string | null
  collateralValue: string | null
  lastUpdatedTimestamp: string | null
  solvent: boolean | null
}

export type ExternalPositionsData = {
  byPositionKey: Map<string, ExternalPositionRecord>
  byMarketKey: Map<string, ExternalPositionRecord[]>
}

const CHAIN_URL_ENV_KEYS: Record<number, string> = {
  1: 'NEXT_PUBLIC_LIQ_POSITIONS_URL_ETHEREUM',
  146: 'NEXT_PUBLIC_LIQ_POSITIONS_URL_SONIC',
  42161: 'NEXT_PUBLIC_LIQ_POSITIONS_URL_ARBITRUM',
  43114: 'NEXT_PUBLIC_LIQ_POSITIONS_URL_AVALANCHE',
}

const CHAIN_KEY_BY_ID: Record<number, string> = {
  1: 'ethereum',
  146: 'sonic',
  42161: 'arbitrum',
  43114: 'avalanche',
}

const CHAIN_FILE_NAMES: Record<number, string> = {
  1: 'ethereum_positions.json',
  146: 'sonic_positions.json',
  42161: 'arbitrum_positions.json',
  43114: 'avalanche_positions.json',
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : null
}

function normalizeRawValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function resolvePositionsSourceUrl(chainId: number): string | null {
  const envKey = CHAIN_URL_ENV_KEYS[chainId]
  const direct = envKey ? process.env[envKey]?.trim() : ''
  if (direct) return direct

  const base = process.env.NEXT_PUBLIC_LIQ_POSITIONS_BASE_URL?.trim() || ''
  const fileName = CHAIN_FILE_NAMES[chainId]
  if (base && fileName) return `${base.replace(/\/$/, '')}/${fileName}`
  const chainKey = CHAIN_KEY_BY_ID[chainId]
  if (chainKey) return `/liquidation/positions/${chainKey}_positions.json`
  return null
}

function parseExternalRecord(chainId: number, raw: unknown): ExternalPositionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const accountId = normalizeAddress(row.account_id)
  const marketId = normalizeAddress(row.debt_market_id)
  if (!accountId || !marketId) return null
  const solventRaw = row.solvent
  const solvent = typeof solventRaw === 'boolean' ? solventRaw : null
  return {
    chainId,
    accountId,
    marketId,
    ltv: normalizeRawValue(row.ltv),
    debtValue: normalizeRawValue(row.debt_value),
    collateralValue: normalizeRawValue(row.collateral_value),
    lastUpdatedTimestamp: normalizeRawValue(row.last_updated_timestamp) ?? normalizeRawValue(row.age_timestamp),
    solvent,
  }
}

export async function fetchExternalPositionsData(chainIds: number[]): Promise<ExternalPositionsData> {
  const byPositionKey = new Map<string, ExternalPositionRecord>()
  const byMarketKey = new Map<string, ExternalPositionRecord[]>()
  const uniqueChains = Array.from(new Set(chainIds)).sort((a, b) => a - b)

  await Promise.all(
    uniqueChains.map(async (chainId) => {
      const chainKey = CHAIN_KEY_BY_ID[chainId] ?? String(chainId)
      const sourceUrl = resolvePositionsSourceUrl(chainId)
      if (!sourceUrl) {
        const envKey = CHAIN_URL_ENV_KEYS[chainId]
        console.info(
          `[positions-external] no source URL for ${chainKey}; set ${envKey ?? 'NEXT_PUBLIC_LIQ_POSITIONS_BASE_URL'}`
        )
        return
      }
      console.info(`[positions-external] loading ${chainKey} positions from ${sourceUrl}`)
      try {
        const res = await fetch(sourceUrl, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
        const payload = (await res.json()) as unknown
        if (!Array.isArray(payload)) throw new Error('Payload is not a JSON array')
        let accepted = 0
        for (const row of payload) {
          const parsed = parseExternalRecord(chainId, row)
          if (!parsed) continue
          accepted += 1
          const positionKey = buildLiquidationPositionKey(chainId, parsed.marketId, parsed.accountId)
          if (!positionKey) continue
          byPositionKey.set(positionKey, parsed)
          const marketKey = `${chainId}:${parsed.marketId}`
          if (!byMarketKey.has(marketKey)) byMarketKey.set(marketKey, [])
          byMarketKey.get(marketKey)!.push(parsed)
        }
        console.info(
          `[positions-external] loaded ${chainKey}: accepted=${accepted}, markets=${Array.from(byMarketKey.keys()).filter((key) => key.startsWith(`${chainId}:`)).length}`
        )
      } catch (error) {
        console.warn(`[positions-external] failed to load ${sourceUrl}`, error)
      }
    })
  )

  return { byPositionKey, byMarketKey }
}
