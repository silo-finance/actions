import { fetchChainSiloSnapshot } from '@/utils/liquidationSilosRemote'
import { isCollateralOnlySilo } from '@/utils/siloMarketRole'

export type StaticSiloConfigData = {
  daoFee: string
  deployerFee: string
  silo: string
  token: string
  protectedShareToken: string
  collateralShareToken: string
  debtShareToken: string
  solvencyOracle: string
  maxLtvOracle: string
  interestRateModel: string
  maxLtv: string
  lt: string
  liquidationTargetLtv: string
  liquidationFee: string
  flashloanFee: string
  hookReceiver: string
  callBeforeQuote: boolean
}

export type RelatedSiloSnapshotData = {
  siloAddress: string
  siloConfigAddress: string | null
  siloId: number | null
  tokenAddress: string | null
  tokenSymbol: string | null
  quoteTokenSymbol?: string | null
  tokenDecimals: number | null
  siloConfig: StaticSiloConfigData | null
}

export type LiquidationSnapshotEntry = {
  chainId: number
  chainKey: string
  marketVersion?: 'v3' | 'legacy'
  siloAddress: string
  siloConfigAddress: string | null
  siloId: number | null
  siloIndex?: 0 | 1 | null
  tokenAddress: string | null
  tokenSymbol: string | null
  quoteTokenSymbol?: string | null
  tokenDecimals: number | null
  siloConfig: StaticSiloConfigData | null
  otherSilo?: RelatedSiloSnapshotData | null
}

/** Chains whose silo snapshots the Positions UI always loads from the data branch. */
export const LIQUIDATION_SNAPSHOT_CHAIN_KEYS = [
  'arbitrum',
  'avalanche',
  'ethereum',
  'injective',
  'sonic',
  'xdc',
] as const

function normalizeMarketVersion(value: unknown): 'v3' | 'legacy' {
  return value === 'legacy' ? 'legacy' : 'v3'
}

function parseAddressCsv(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set()
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null
  return n
}

export type LiquidationSnapshotConfig = {
  filteredSiloAddresses: Set<string>
  testApiLimit: number | null
  testGraphLimit: number | null
  testDisablePagination: boolean
}

export function getLiquidationSnapshotConfig(): LiquidationSnapshotConfig {
  return {
    filteredSiloAddresses: parseAddressCsv(process.env.NEXT_PUBLIC_TEST_SILO_IDS),
    testApiLimit: parsePositiveInt(process.env.NEXT_PUBLIC_TEST_API_LIMIT),
    testGraphLimit: parsePositiveInt(process.env.NEXT_PUBLIC_TEST_GRAPH_LIMIT),
    testDisablePagination: process.env.NEXT_PUBLIC_TEST_DISABLE_PAGINATION === 'true',
  }
}

function applySnapshotFilters(entries: LiquidationSnapshotEntry[]): LiquidationSnapshotEntry[] {
  const config = getLiquidationSnapshotConfig()
  const normalized = entries.map((row) => ({
    ...row,
    marketVersion: normalizeMarketVersion(row.marketVersion),
  }))
  const allowlisted =
    config.filteredSiloAddresses.size > 0
      ? normalized.filter((row) => config.filteredSiloAddresses.has(row.siloAddress.toLowerCase()))
      : normalized
  // Consume-path only: keep full static JSON on the data branch; skip one-way collateral markets here.
  const filtered = allowlisted.filter(
    (row) =>
      !isCollateralOnlySilo(row.siloConfig?.lt ?? null, row.otherSilo?.siloConfig?.lt ?? null)
  )
  if (config.testApiLimit == null) return filtered
  return filtered.slice(0, config.testApiLimit)
}

/**
 * Load all chain silo snapshots from the remote data branch.
 * Fails hard if any chain URL is missing, HTTP fails, JSON is invalid, or silos is empty.
 */
export async function fetchLiquidationSnapshotEntries(): Promise<LiquidationSnapshotEntry[]> {
  const snapshots = await Promise.all(
    LIQUIDATION_SNAPSHOT_CHAIN_KEYS.map((chainKey) => fetchChainSiloSnapshot(chainKey))
  )
  return applySnapshotFilters(snapshots.flatMap((snapshot) => snapshot.silos))
}

const FNV1A64_OFFSET = BigInt('0xcbf29ce484222325')
const FNV1A64_PRIME = BigInt('0x100000001b3')
const FNV1A64_MASK = BigInt('0xffffffffffffffff')

/** Non-cryptographic fingerprint for cache keys (FNV-1a 64-bit → 16 hex chars). */
function fnv1a64Hex(input: string): string {
  let hash = FNV1A64_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV1A64_PRIME) & FNV1A64_MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Short stable key for a snapshot market set (localStorage / React Query).
 * Hashes the canonical `chainId:address|…` join so keys stay small as markets grow.
 */
export function buildLiquidationSnapshotKey(
  entries: Pick<LiquidationSnapshotEntry, 'chainId' | 'siloAddress'>[]
): string {
  const canonical = entries.map((row) => `${row.chainId}:${row.siloAddress.toLowerCase()}`).join('|')
  return fnv1a64Hex(canonical)
}
