import arbitrumSnapshot from '@/data/liquidation/silos/arbitrum.json'
import avalancheSnapshot from '@/data/liquidation/silos/avalanche.json'
import ethereumSnapshot from '@/data/liquidation/silos/ethereum.json'
import injectiveSnapshot from '@/data/liquidation/silos/injective.json'
import sonicSnapshot from '@/data/liquidation/silos/sonic.json'
import xdcSnapshot from '@/data/liquidation/silos/xdc.json'

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

type ChainSnapshotFile = {
  chainId: number
  chainKey: string
  generatedAt: string
  silos: LiquidationSnapshotEntry[]
}

const SNAPSHOTS: ChainSnapshotFile[] = [
  arbitrumSnapshot as ChainSnapshotFile,
  avalancheSnapshot as ChainSnapshotFile,
  ethereumSnapshot as ChainSnapshotFile,
  injectiveSnapshot as ChainSnapshotFile,
  sonicSnapshot as ChainSnapshotFile,
  xdcSnapshot as ChainSnapshotFile,
]

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

export function getLiquidationSnapshotEntries(): LiquidationSnapshotEntry[] {
  const config = getLiquidationSnapshotConfig()
  const out = SNAPSHOTS.flatMap((snapshot) =>
    snapshot.silos.map((row) => ({
      ...row,
      marketVersion: normalizeMarketVersion(row.marketVersion),
    }))
  )
  const filtered =
    config.filteredSiloAddresses.size > 0
      ? out.filter((row) =>
          config.filteredSiloAddresses.has(row.siloAddress.toLowerCase())
        )
      : out
  if (config.testApiLimit == null) return filtered
  return filtered.slice(0, config.testApiLimit)
}
