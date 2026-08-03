import type { LiquidationSnapshotEntry } from '@/utils/liquidationSnapshot'

export type ChainSnapshotFile = {
  chainId: number
  chainKey: string
  generatedAt: string
  silos: LiquidationSnapshotEntry[]
}

const CHAIN_URL_ENV_KEYS: Record<string, string> = {
  ethereum: 'NEXT_PUBLIC_LIQ_SILOS_URL_ETHEREUM',
  xdc: 'NEXT_PUBLIC_LIQ_SILOS_URL_XDC',
  sonic: 'NEXT_PUBLIC_LIQ_SILOS_URL_SONIC',
  injective: 'NEXT_PUBLIC_LIQ_SILOS_URL_INJECTIVE',
  arbitrum: 'NEXT_PUBLIC_LIQ_SILOS_URL_ARBITRUM',
  avalanche: 'NEXT_PUBLIC_LIQ_SILOS_URL_AVALANCHE',
}

/** Append a unique value so the browser/CDN never serves a stale silo snapshot. */
function appendCacheBust(url: string): string {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}_cb=${token}`
}

export function resolveSilosSourceUrl(chainKey: string): string {
  const envKey = CHAIN_URL_ENV_KEYS[chainKey]
  const direct = envKey ? process.env[envKey]?.trim() : ''
  if (direct) return direct

  const base = process.env.NEXT_PUBLIC_LIQ_SILOS_BASE_URL?.trim() || ''
  if (!base) {
    throw new Error(
      `Missing silo snapshot URL for ${chainKey}. Set ${envKey ?? 'NEXT_PUBLIC_LIQ_SILOS_URL_*'} or NEXT_PUBLIC_LIQ_SILOS_BASE_URL.`
    )
  }
  return `${base.replace(/\/$/, '')}/${chainKey}.json`
}

function isSnapshotEntry(value: unknown): value is LiquidationSnapshotEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.chainId === 'number' &&
    typeof row.chainKey === 'string' &&
    typeof row.siloAddress === 'string' &&
    row.siloAddress.length > 0
  )
}

export function parseChainSnapshotFile(chainKey: string, payload: unknown): ChainSnapshotFile {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Silo snapshot for ${chainKey} is not a JSON object`)
  }
  const file = payload as Record<string, unknown>
  if (typeof file.chainId !== 'number' || !Number.isFinite(file.chainId)) {
    throw new Error(`Silo snapshot for ${chainKey} is missing a valid chainId`)
  }
  if (typeof file.chainKey !== 'string' || !file.chainKey.trim()) {
    throw new Error(`Silo snapshot for ${chainKey} is missing chainKey`)
  }
  if (!Array.isArray(file.silos)) {
    throw new Error(`Silo snapshot for ${chainKey} is missing a silos array`)
  }
  for (let i = 0; i < file.silos.length; i++) {
    if (!isSnapshotEntry(file.silos[i])) {
      throw new Error(`Silo snapshot for ${chainKey} has an invalid entry at index ${i}`)
    }
  }
  return {
    chainId: file.chainId,
    chainKey: file.chainKey,
    generatedAt: typeof file.generatedAt === 'string' ? file.generatedAt : '',
    silos: file.silos as LiquidationSnapshotEntry[],
  }
}

export async function fetchChainSiloSnapshot(chainKey: string): Promise<ChainSnapshotFile> {
  const sourceUrl = resolveSilosSourceUrl(chainKey)
  const requestUrl = appendCacheBust(sourceUrl)
  console.info(`[silos-remote] loading ${chainKey} from ${requestUrl}`)
  const res = await fetch(requestUrl, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Silo snapshot fetch failed for ${chainKey}: HTTP ${res.status} ${res.statusText}`)
  }
  const payload = (await res.json()) as unknown
  const parsed = parseChainSnapshotFile(chainKey, payload)
  if (parsed.silos.length === 0) {
    throw new Error(`Silo snapshot for ${chainKey} has no markets (empty silos array)`)
  }
  console.info(`[silos-remote] loaded ${chainKey}: markets=${parsed.silos.length}`)
  return parsed
}
