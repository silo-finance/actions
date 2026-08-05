'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import HotValueFlame from '@/components/HotValueFlame'
import FormattedDecimal from '@/components/FormattedDecimal'
import PositionPriorityTicks from '@/components/PositionPriorityTicks'
import BlacklistMarketsBar, {
  type BlacklistBarItem,
} from '@/components/positions/BlacklistMarketsBar'
import BlacklistTrashButton from '@/components/positions/BlacklistTrashButton'
import SiloMarketRoleIcon from '@/components/positions/SiloMarketRoleIcon'
import { resolveSiloMarketRole } from '@/utils/siloMarketRole'
import { useWeb3 } from '@/contexts/Web3Context'
import {
  getExplorerAddressUrl,
  getNetworkDisplayName,
  getNetworkIconPath,
  getNetworkShortName,
} from '@/utils/networks'
import {
  buildLiquidationSnapshotKey,
  fetchLiquidationSnapshotEntries,
  getLiquidationSnapshotConfig,
} from '@/utils/liquidationSnapshot'
import { ensureLocalStorageSchema } from '@/utils/storage/localStorageSchema'
import {
  fetchAllOpenPositionsByMarket,
  fetchAllOpenPositionsByChainAndMarket,
  fetchOpenPositionCountsByChainAndMarket,
  type OpenMarketPosition,
} from '@/utils/liquidationGraph'
import { fetchExternalPositionsData } from '@/utils/liquidationExternalPositions'
import { buildLiquidationPositionKey, extractBorrowerAddress } from '@/utils/liquidationPositionIdentity'
import { resolveHotValuePositionIds } from '@/utils/positionHotValue'
import { mergeMarketPositionItems, solvencyMapFromExternalMarket } from '@/utils/liquidationPositionMerge'
import {
  fetchBorrowersLtvFromSiloLens,
  fetchBorrowersSolvency,
  fetchMarketsDynamicState,
  getSiloLensAddressForChain,
} from '@/utils/liquidationRpc'
import { formatUnits } from 'ethers'
import {
  capDisplayHealthFactor,
  computeHealthFactor,
  computePositionPriority,
  positionRiskSortTier,
  priorityScaleForRiskTier,
  resolvePositionPriorityScaleByTier,
  type PositionPriorityScaleByTier,
} from '@/utils/healthFactor'

type MarketRow = {
  chainId: number
  chainKey: string
  chainName: string
  chainDisplayName: string
  chainIconPath: string | null
  siloAddress: string
  siloId: number | null
  siloIndex: 0 | 1 | null
  otherSiloAddress: string | null
  tokenAddress: string | null
  tokenSymbol: string | null
  quoteTokenSymbol: string | null
  otherTokenAddress: string | null
  otherTokenSymbol: string | null
  otherTokenDecimals: number | null
  ltRaw: string | null
  otherLtRaw: string | null
  marketTokenPair: string
  tokenDecimals: number | null
  totalAssets: bigint | null
  totalDebt: bigint | null
  liquidity: bigint | null
  externalLiquidity: bigint | null
  hasExternalLiquiditySource: boolean | null
  externalLiquiditySources:
    | Array<{
        sourceAddress: string
        amount: bigint
        version: string
      }>
    | null
  otherTotalAssets: bigint | null
  otherLiquidity: bigint | null
  otherTotalDebt: bigint | null
  positionsCount: number | null
  normalPositionsCount: number | null
  warningPositionsCount: number | null
  insolventPositionsCount: number | null
  needsSanityAlert: boolean
  marketVersion: 'v3' | 'legacy'
}

function marketRowKey(row: Pick<MarketRow, 'chainId' | 'siloAddress'>): string {
  return `${row.chainId}:${row.siloAddress.toLowerCase()}`
}

const DEFAULT_GRAPH_PAGE_LIMIT = 1000
const POSITIONS_VIEW_PAGE_LIMIT = 1000
const DEFAULT_POSITION_MIN_DEBT_VALUE = '1.0'
const DEFAULT_POSITIONS_COUNT_CHUNK = 40
const BIGINT_ZERO = BigInt(0)
const WARNING_HEALTH_FACTOR_THRESHOLD = 0.95
const MAX_DISPLAY_LTV_PERCENT = 999
/** Applied to table columns not refreshed by LIVE (collateral, debt, age). */
const POSITIONS_LIVE_STALE_COLUMN_CLASS = 'opacity-40 transition-opacity'
const REALTIME_REFRESH_INTERVAL_SECONDS = 60
const REALTIME_AGE_THRESHOLD_SECONDS = 30 * 60
const MARKET_DATA_STALE_TIME_MS = 1000 * 60 * 5

type SortColumn =
  | 'siloId'
  | 'chain'
  | 'token'
  | 'totalAssets'
  | 'liquidity'
  | 'totalDebt'
  | 'positions'

type SortDirection = 'asc' | 'desc'
type PositionsSortColumn = 'healthFactor' | 'priority' | 'ltv' | 'debtValue' | 'collateralValue'

type ColumnFilters = {
  token: string
  hideZeroPositions: boolean
}

type PositionListFilters = {
  borrowerAddress: string
  minDebtValueInput: string
}

const DEFAULT_MARKET_SORT_COLUMN: SortColumn = 'positions'
const DEFAULT_POSITIONS_SORT_COLUMN: PositionsSortColumn = 'priority'
const MIN_DEBT_URL_OFF = 'off'

const MARKET_SORT_COLUMNS = new Set<SortColumn>([
  'siloId',
  'chain',
  'token',
  'totalAssets',
  'liquidity',
  'totalDebt',
  'positions',
])

const POSITIONS_SORT_COLUMNS = new Set<PositionsSortColumn>([
  'healthFactor',
  'priority',
  'ltv',
  'debtValue',
  'collateralValue',
])

function parseSortDirection(raw: string | null): SortDirection {
  return raw === 'asc' ? 'asc' : 'desc'
}

function parseMarketSortColumn(raw: string | null): SortColumn | null {
  if (!raw || !MARKET_SORT_COLUMNS.has(raw as SortColumn)) return null
  return raw as SortColumn
}

function parsePositionsSortColumn(raw: string | null): PositionsSortColumn | null {
  if (!raw || !POSITIONS_SORT_COLUMNS.has(raw as PositionsSortColumn)) return null
  return raw as PositionsSortColumn
}

function parseChainsParam(raw: string | null): Set<number> {
  if (!raw?.trim()) return new Set()
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const chainId = Number(part.trim())
    if (Number.isFinite(chainId) && Number.isInteger(chainId) && chainId > 0) out.add(chainId)
  }
  return out
}

function serializeChainsParam(chains: Set<number>): string | null {
  if (chains.size === 0) return null
  return Array.from(chains)
    .sort((a, b) => a - b)
    .join(',')
}

function parseMinDebtUrlParam(raw: string | null): string {
  if (raw === MIN_DEBT_URL_OFF) return ''
  if (raw == null) return DEFAULT_POSITION_MIN_DEBT_VALUE
  return raw
}

function writeMinDebtUrlParam(params: URLSearchParams, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) {
    params.set('minDebt', MIN_DEBT_URL_OFF)
    return
  }
  if (trimmed === DEFAULT_POSITION_MIN_DEBT_VALUE) {
    params.delete('minDebt')
    return
  }
  params.set('minDebt', trimmed)
}

type DynamicStateType = Awaited<ReturnType<typeof fetchMarketsDynamicState>> extends Map<string, infer T> ? T : never

type PersistedEnvelope<TData> = {
  fetchedAt: number
  data: TData
}

type PersistedDynamicState = {
  siloAddress: string
  totalAssetsStorage: string
  totalAssets: string
  interest: string
  liquidity: string
  totalDebt: string
  externalLiquidity: string
  hasExternalLiquiditySource: boolean
  externalLiquiditySources: Array<{
    sourceAddress: string
    amount: string
    version: string
  }>
}

type PrefetchedMarketPositionsEntry = {
  chainId: number
  siloAddress: string
  fetchedAt: number
  items: OpenMarketPosition[]
  totalCount: number
  warningCount: number
  insolventCount: number
  solvencyByBorrower: Array<readonly [string, boolean]>
}

function normalizeSnapshotMarketVersion(value: unknown): 'v3' | 'legacy' {
  return value === 'legacy' ? 'legacy' : 'v3'
}

function shortenAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function shortenSiloAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 5)}…${address.slice(-5)}`
}

function parseIntParam(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null
  return n
}

function capDisplayLtvPercent(percent: number): number {
  if (!Number.isFinite(percent)) return percent
  return Math.min(percent, MAX_DISPLAY_LTV_PERCENT)
}

function formatPositionLtv(raw: string | null): string {
  const n = parseScaledNumber(raw, 18)
  if (n == null) return '—'
  return `${capDisplayLtvPercent(n * 100).toFixed(2)}%`
}

function PositionLtvDisplay({ raw }: { raw: string | null }) {
  const formatted = formatPositionLtv(raw)
  if (formatted === '—' || !formatted.endsWith('%')) return formatted
  return (
    <span className="inline-flex items-baseline tabular-nums">
      <span>{formatted.slice(0, -1)}</span>
      <span className="text-[0.82em]">%</span>
    </span>
  )
}

function formatHealthFactor(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const roundedDown = Math.floor(capDisplayHealthFactor(value) * 100) / 100
  return roundedDown.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatPercentCompact(valueRatio: number | null, maxFractionDigits = 2): string {
  if (valueRatio == null) return '—'
  const pct = valueRatio * 100
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })}%`
}

function parseScaledNumber(raw: string | null, decimals = 18): number | null {
  if (!raw) return null
  const parsed = /^-?\d+$/.test(raw) ? Number(formatUnits(BigInt(raw), decimals)) : Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** Parses a human-entered decimal (`.` or `,` as the decimal separator). */
function parseDecimalFilterInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBorrowerSearchText(raw: string): string {
  return raw.trim().toLowerCase().replace(/^0x/, '')
}

function borrowerTextForFilter(scored: ScoredPositionRow): string {
  return (scored.borrowerAddress ?? scored.row.accountId).toLowerCase()
}

function positionMatchesBorrowerFilter(scored: ScoredPositionRow, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  const haystack = borrowerTextForFilter(scored).replace(/^0x/, '')
  return haystack.includes(normalizedQuery)
}

function formatScaledValue(raw: string | null, decimals = 18, maxFractionDigits = 2): string {
  const parsed = parseScaledNumber(raw, decimals)
  if (parsed == null) return '—'
  if (parsed !== 0 && Math.abs(parsed) < 10 ** -maxFractionDigits) {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 20,
      maximumSignificantDigits: 2,
      useGrouping: false,
    }).format(parsed)
  }
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  })
}

function parsePositionTimestampMs(raw: string | null): number | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  if (/^\d+$/.test(value)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return parsed > 1_000_000_000_000 ? parsed : parsed * 1000
  }
  const asDate = Date.parse(value)
  return Number.isFinite(asDate) ? asDate : null
}

function formatEnglishCount(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`
}

function areStringMapsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  let same = true
  a.forEach((value, key) => {
    if (!same) return
    if (b.get(key) !== value) same = false
  })
  return same
}

function formatPositionAge(rawTimestamp: string | null, nowMs: number): string {
  const timestampMs = parsePositionTimestampMs(rawTimestamp)
  if (timestampMs == null) return '—'
  const ageSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  if (ageSeconds < 60) {
    return formatEnglishCount(ageSeconds, 'second')
  }
  const ageMinutes = Math.floor(ageSeconds / 60)
  if (ageMinutes < 60) {
    return formatEnglishCount(ageMinutes, 'minute')
  }
  const ageHours = Math.floor(ageMinutes / 60)
  if (ageHours < 24) {
    return formatEnglishCount(ageHours, 'hour')
  }
  const ageDays = Math.floor(ageHours / 24)
  if (ageDays < 30) {
    return formatEnglishCount(ageDays, 'day')
  }
  const ageYears = Math.floor(ageDays / 365)
  if (ageYears < 1) {
    // Below a full year, render months so we never show a misleading "0 years".
    return formatEnglishCount(Math.floor(ageDays / 30), 'month')
  }
  return formatEnglishCount(ageYears, 'year')
}

function formatMetric(value: bigint | null, decimals: number | null, maximumFractionDigits = 3): string {
  if (value == null) return '—'
  const parsed = Number(formatUnits(value, decimals ?? 18))
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}

function formatMetricFixed(value: bigint | null, decimals: number | null, fractionDigits: number): string {
  if (value == null) return '—'
  const parsed = Number(formatUnits(value, decimals ?? 18))
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}

function formatWholeTokenMetric(value: bigint | null, decimals: number | null): string {
  if (value == null) return '—'
  const normalized = formatUnits(value, Math.max(0, decimals ?? 18))
  const [wholePartRaw] = normalized.split('.')
  const wholeTokens = BigInt(wholePartRaw ?? '0')
  return wholeTokens.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatExternalSourceName(versionLabel: string): string {
  const normalized = versionLabel.trim()
  if (!normalized) return '?'
  const [name] = normalized.split(/\s+/)
  return name || '?'
}

function compareValues(a: string | number | bigint | null, b: string | number | bigint | null): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (typeof a === 'bigint' && typeof b === 'bigint') return a > b ? 1 : a < b ? -1 : 0
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const aa = String(a).toLowerCase()
  const bb = String(b).toLowerCase()
  return aa.localeCompare(bb)
}

function formatRelativeAge(fromMs: number, nowMs: number): string {
  if (!fromMs || fromMs <= 0) return 'not loaded yet'
  const deltaSeconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  const minutes = Math.floor(deltaSeconds / 60)
  const seconds = deltaSeconds % 60
  if (deltaSeconds < 3600) {
    if (seconds === 0) return `${minutes}m ago`
    return `${minutes}m ${seconds}s ago`
  }
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (remMinutes === 0) return `${hours}h ago`
  return `${hours}h ${remMinutes}m ago`
}

function getRelativeAgeSeconds(fromMs: number, nowMs: number): number | null {
  if (!fromMs || fromMs <= 0) return null
  return Math.max(0, Math.floor((nowMs - fromMs) / 1000))
}

function getPositionsFreshnessTextClass(ageSeconds: number | null): string {
  if (ageSeconds == null) return 'text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]'
  if (ageSeconds > 60 * 60 * 24) return 'text-[color-mix(in_srgb,var(--silo-danger)_85%,#4f0f1c)]'
  if (ageSeconds > 60 * 60) return 'text-[color-mix(in_srgb,var(--silo-warning)_90%,#5a3b12)]'
  return 'text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]'
}

function getMarketsFreshnessTextClass(ageSeconds: number | null): string {
  if (ageSeconds == null) return 'text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]'
  if (ageSeconds > 60 * 60 * 24 * 3) return 'text-[color-mix(in_srgb,var(--silo-danger)_85%,#4f0f1c)]'
  if (ageSeconds > 60 * 60 * 24) return 'text-[color-mix(in_srgb,var(--silo-warning)_90%,#5a3b12)]'
  return 'text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]'
}

function isWarningHealthFactor(healthFactor: number | null, isInsolvent: boolean): boolean {
  return !isInsolvent && healthFactor != null && healthFactor >= WARNING_HEALTH_FACTOR_THRESHOLD
}

/** Solvent when LTV is at or below the market liquidation threshold (matches on-chain / export scripts). */
function deriveSolventFromLtvRatio(ltvRatio: number | null, ltRatio: number | null): boolean | null {
  if (ltvRatio == null || ltRatio == null || ltRatio <= 0) return null
  return ltvRatio <= ltRatio
}

function resolveEffectiveLtvRaw(
  row: OpenMarketPosition,
  borrowerAddress: string | null,
  realtimeLtvByBorrower: Map<string, string>
): string | null {
  if (borrowerAddress && realtimeLtvByBorrower.has(borrowerAddress)) {
    return realtimeLtvByBorrower.get(borrowerAddress) ?? row.ltv
  }
  return row.ltv
}

function resolvePositionSolvent({
  effectiveLtvRaw,
  positionLtRatio,
  externalSolvent,
  rpcSolvent,
  preferLtvDerivation,
}: {
  effectiveLtvRaw: string | null
  positionLtRatio: number | null
  externalSolvent: boolean | null | undefined
  rpcSolvent: boolean | null | undefined
  preferLtvDerivation: boolean
}): boolean | null {
  if (preferLtvDerivation) {
    const derived = deriveSolventFromLtvRatio(parseScaledNumber(effectiveLtvRaw, 18), positionLtRatio)
    if (derived != null) return derived
  }
  if (externalSolvent != null) return externalSolvent
  if (rpcSolvent != null) return rpcSolvent
  if (!preferLtvDerivation) {
    return deriveSolventFromLtvRatio(parseScaledNumber(effectiveLtvRaw, 18), positionLtRatio)
  }
  return null
}

function formatLtvPercentFromRaw18(ltvRaw18: string): string {
  if (/^-?\d+$/.test(ltvRaw18)) {
    const pct = Number(formatUnits(BigInt(ltvRaw18), 16))
    if (!Number.isFinite(pct)) return formatUnits(BigInt(ltvRaw18), 16)
    return `${capDisplayLtvPercent(pct).toFixed(2)}%`
  }
  const parsed = Number(ltvRaw18)
  if (Number.isFinite(parsed)) return `${capDisplayLtvPercent(parsed * 100).toFixed(2)}%`
  return ltvRaw18
}

type ScoredPositionRow = {
  row: OpenMarketPosition
  borrowerAddress: string | null
  effectiveLtvRaw: string | null
  ltvRatio: number | null
  healthFactor: number | null
  priority: number | null
  debtValueNum: number | null
  collateralValueNum: number | null
  isSolvent: boolean | null
  isInsolvent: boolean
  isWarning: boolean
  hasLiveLtv: boolean
}

function scoreOpenMarketPosition(
  row: OpenMarketPosition,
  options: {
    selectedRow: { chainId: number; siloAddress: string } | null
    positionLtRatio: number | null
    realtimeLtvByBorrower: Map<string, string>
    externalByPositionKey: Map<string, { solvent?: boolean | null }> | undefined
    solvencyByBorrower: Map<string, boolean> | undefined
  }
): ScoredPositionRow {
  const borrowerAddress = extractBorrowerAddress(row.accountId)
  const hasLiveLtv = Boolean(borrowerAddress && options.realtimeLtvByBorrower.has(borrowerAddress))
  const effectiveLtvRaw = resolveEffectiveLtvRaw(row, borrowerAddress, options.realtimeLtvByBorrower)
  const ltvRatio = parseScaledNumber(effectiveLtvRaw, 18)
  const healthFactor = computeHealthFactor(ltvRatio, options.positionLtRatio)
  const externalKey =
    options.selectedRow && borrowerAddress
      ? buildLiquidationPositionKey(options.selectedRow.chainId, options.selectedRow.siloAddress, borrowerAddress)
      : null
  const external = externalKey ? options.externalByPositionKey?.get(externalKey) : undefined
  const isSolvent = resolvePositionSolvent({
    effectiveLtvRaw,
    positionLtRatio: options.positionLtRatio,
    externalSolvent: external?.solvent,
    rpcSolvent: borrowerAddress ? options.solvencyByBorrower?.get(borrowerAddress) : undefined,
    preferLtvDerivation: hasLiveLtv,
  })
  const debtValueNum = parseScaledNumber(row.debtValue, 18)
  const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
  const isWarning = isWarningHealthFactor(healthFactor, isInsolvent)
  const priority = computePositionPriority(debtValueNum, healthFactor)
  return {
    row,
    borrowerAddress,
    effectiveLtvRaw,
    ltvRatio,
    healthFactor,
    priority,
    debtValueNum,
    collateralValueNum: parseScaledNumber(row.collateralValue, 18),
    isSolvent,
    isInsolvent,
    isWarning,
    hasLiveLtv,
  }
}

function shouldMonitorPositionInRealtime({
  row,
  positionLtRatio,
  isSolvent,
  nowMs,
}: {
  row: OpenMarketPosition
  positionLtRatio: number | null
  isSolvent: boolean | null | undefined
  nowMs: number
}): boolean {
  const ltvRatio = parseScaledNumber(row.ltv, 18)
  const healthFactor = computeHealthFactor(ltvRatio, positionLtRatio)
  const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
  const isWarning = isWarningHealthFactor(healthFactor, isInsolvent)
  const timestampMs = parsePositionTimestampMs(row.lastUpdatedTimestamp)
  const ageSeconds = timestampMs == null ? null : Math.max(0, Math.floor((nowMs - timestampMs) / 1000))
  const isOlderThanThreshold = ageSeconds != null && ageSeconds > REALTIME_AGE_THRESHOLD_SECONDS
  return isWarning || isInsolvent || isOlderThanThreshold
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function InlineCopyIconButton({
  value,
  copyLabel,
  className = '',
}: {
  value: string
  copyLabel: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleClick = useCallback(async () => {
    const didCopy = await copyToClipboard(value)
    if (!didCopy) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [value])

  return (
    <button
      type="button"
      className={`${className} inline-flex items-center justify-center min-w-4`}
      aria-label={copyLabel}
      title={copied ? 'Copied' : copyLabel}
      onClick={() => {
        void handleClick()
      }}
    >
      {copied ? (
        <svg
          className="w-3.5 h-3.5 text-[color-mix(in_srgb,var(--silo-success)_96%,#0b5d3f)]"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
        >
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        '⧉'
      )}
    </button>
  )
}

function isZeroLt(raw: string | null): boolean {
  const value = parseScaledNumber(raw, 18)
  return value != null && value === 0
}

function resolveEffectiveLtRawForMarket(row: Pick<MarketRow, 'siloId' | 'ltRaw' | 'otherLtRaw'>): string | null {
  const isV3 = (row.siloId ?? 0) > 3000
  if (isV3) return row.otherLtRaw ?? row.ltRaw
  const thisIsZero = isZeroLt(row.ltRaw)
  const otherIsZero = isZeroLt(row.otherLtRaw)
  if (thisIsZero !== otherIsZero) {
    return thisIsZero ? row.otherLtRaw ?? row.ltRaw : row.ltRaw
  }
  return row.ltRaw
}

function canUseBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readPersisted<TData>(storageKey: string): PersistedEnvelope<TData> | null {
  if (!canUseBrowserStorage()) return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedEnvelope<TData>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.fetchedAt !== 'number' || !Number.isFinite(parsed.fetchedAt)) return null
    if (!('data' in parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function writePersisted<TData>(storageKey: string, payload: PersistedEnvelope<TData>): void {
  if (!canUseBrowserStorage()) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  } catch {
    // Ignore quota/storage errors; runtime cache still works in memory.
  }
}

function serializeDynamicStateMap(map: Map<string, DynamicStateType>) {
  return Array.from(map.entries()).map(([key, value]) => [
    key,
    {
      siloAddress: value.siloAddress,
      totalAssetsStorage: value.totalAssetsStorage.toString(),
      totalAssets: value.totalAssets.toString(),
      interest: value.interest.toString(),
      liquidity: value.liquidity.toString(),
      totalDebt: value.totalDebt.toString(),
      externalLiquidity: value.externalLiquidity.toString(),
      hasExternalLiquiditySource: value.hasExternalLiquiditySource,
      externalLiquiditySources: value.externalLiquiditySources.map((source) => ({
        sourceAddress: source.sourceAddress,
        amount: source.amount.toString(),
        version: source.version,
      })),
    } satisfies PersistedDynamicState,
  ] as const)
}

function stripLegacyMarketsFromPrefetchCache(
  cached: Map<string, PrefetchedMarketPositionsEntry>,
  markets: Array<{ chainId: number; siloAddress: string; marketVersion: 'v3' | 'legacy' }>
): Map<string, PrefetchedMarketPositionsEntry> {
  const legacyKeys = new Set(
    markets
      .filter((row) => row.marketVersion === 'legacy')
      .map((row) => `${row.chainId}:${row.siloAddress.toLowerCase()}`)
  )
  if (legacyKeys.size === 0) return cached
  const out = new Map(cached)
  legacyKeys.forEach((key) => out.delete(key))
  return out
}

function stripLegacyCountsFromCache(
  cached: Map<string, number>,
  markets: Array<{ chainId: number; siloAddress: string; marketVersion: 'v3' | 'legacy' }>
): Map<string, number> {
  const legacyKeys = new Set(
    markets
      .filter((row) => row.marketVersion === 'legacy')
      .map((row) => `${row.chainId}:${row.siloAddress.toLowerCase()}`)
  )
  if (legacyKeys.size === 0) return cached
  const out = new Map(cached)
  legacyKeys.forEach((key) => out.delete(key))
  return out
}

function deserializeDynamicStateMap(
  payload:
    | Array<readonly [string, PersistedDynamicState]>
    | null
    | undefined
): Map<string, DynamicStateType> {
  const out = new Map<string, DynamicStateType>()
  if (!payload) return out
  for (const row of payload) {
    const [key, value] = row
    out.set(key, {
      siloAddress: value.siloAddress,
      totalAssetsStorage: BigInt(value.totalAssetsStorage),
      totalAssets: BigInt(value.totalAssets),
      interest: BigInt(value.interest),
      liquidity: BigInt(value.liquidity),
      totalDebt: BigInt(value.totalDebt),
      externalLiquidity: BigInt(value.externalLiquidity ?? '0'),
      hasExternalLiquiditySource: Boolean(value.hasExternalLiquiditySource),
      externalLiquiditySources: (value.externalLiquiditySources ?? []).map((source) => ({
        sourceAddress: source.sourceAddress,
        amount: BigInt(source.amount ?? '0'),
        version: source.version ?? '?',
      })),
    })
  }
  return out
}

function InlineLoadingHint() {
  return (
    <span className="inline-flex items-center" aria-label="Loading">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color-mix(in_srgb,var(--silo-accent)_70%,var(--silo-soft-purple))] animate-pulse" />
    </span>
  )
}

/** Faint paired-silo metrics; uses `otherSilo.tokenDecimals` from snapshot, not the row primary token. */
function OtherSiloMetricSubline({
  value,
  decimals,
  maximumFractionDigits = 3,
  enabled,
  isLoading,
  hasError,
  styledFraction = false,
}: {
  value: bigint | null
  /** From snapshot `otherSilo.tokenDecimals` (paired token may differ from primary). */
  decimals: number | null
  maximumFractionDigits?: number
  enabled: boolean
  isLoading: boolean
  hasError: boolean
  styledFraction?: boolean
}) {
  if (!enabled) return <MetricSublineSpacer />
  return (
    <div className="text-xs mt-1 silo-text-faint tabular-nums">
      {value == null ? (
        isLoading || !hasError ? (
          <InlineLoadingHint />
        ) : (
          '—'
        )
      ) : styledFraction ? (
        <FormattedDecimal value={formatMetric(value, decimals, maximumFractionDigits)} />
      ) : (
        formatMetric(value, decimals, maximumFractionDigits)
      )}
    </div>
  )
}

function MetricSublineSpacer() {
  return (
    <div className="text-xs mt-1 tabular-nums select-none" aria-hidden>
      &nbsp;
    </div>
  )
}

/** Offset to the right of the primary metric; does not shift the numeric value. */
function LiquidityStressAlertMarkers({
  count,
  tone,
}: {
  count: 1 | 2
  tone: 'danger' | 'warning'
}) {
  const toneClass =
    tone === 'danger'
      ? 'font-bold text-[var(--silo-danger)]'
      : 'font-bold text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)]'
  return (
    <span
      className="absolute top-1/2 -translate-y-1/2 left-full ml-1 inline-flex gap-px"
      aria-hidden
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={toneClass}>
          !
        </span>
      ))}
    </span>
  )
}

function toErrorDump(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const extended = error as Error & Record<string, unknown>
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined,
      query: extended.query,
      variables: extended.variables,
      extra: extended.extra,
    }
  }
  if (typeof error === 'object' && error != null) {
    return { ...(error as Record<string, unknown>) }
  }
  return { value: error }
}

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function PositionsPageInner() {
  const { provider: walletProvider, chainId: walletChainId } = useWeb3()
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const config = getLiquidationSnapshotConfig()
  const view = searchParams.get('view') === 'positions' ? 'positions' : 'markets'
  const sortDirection = parseSortDirection(searchParams.get('dir'))
  const sortColumn =
    view === 'markets'
      ? (parseMarketSortColumn(searchParams.get('sort')) ?? DEFAULT_MARKET_SORT_COLUMN)
      : DEFAULT_MARKET_SORT_COLUMN
  const positionsSortColumn =
    view === 'positions'
      ? (parsePositionsSortColumn(searchParams.get('sort')) ?? DEFAULT_POSITIONS_SORT_COLUMN)
      : DEFAULT_POSITIONS_SORT_COLUMN
  const selectedChains = useMemo(() => parseChainsParam(searchParams.get('chains')), [searchParams])
  const filters = useMemo(
    (): ColumnFilters => ({
      token: searchParams.get('q') ?? '',
      hideZeroPositions: searchParams.get('hideEmpty') !== '0',
    }),
    [searchParams]
  )
  const positionFilters = useMemo(
    (): PositionListFilters => ({
      borrowerAddress: searchParams.get('borrower') ?? '',
      minDebtValueInput: parseMinDebtUrlParam(searchParams.get('minDebt')),
    }),
    [searchParams]
  )

  const replaceSearchParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString())
      mutate(next)
      const qs = next.toString()
      void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )
  const [isClientMounted, setIsClientMounted] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isRealtimeEnabled, setIsRealtimeEnabled] = useState(false)
  const [realtimeLtvByBorrower, setRealtimeLtvByBorrower] = useState<Map<string, string>>(new Map())
  const [solventFlashByBorrower, setSolventFlashByBorrower] = useState<Map<string, 'improved' | 'worsened'>>(new Map())
  const prevSolventByBorrowerRef = useRef<Map<string, boolean>>(new Map())
  const realtimeSolventBaselineSeededRef = useRef(false)
  const [customRealtimeBorrowers, setCustomRealtimeBorrowers] = useState<string[]>([])
  const [realtimeNextRefreshAtMs, setRealtimeNextRefreshAtMs] = useState<number | null>(null)
  const [marketsTimerMs, setMarketsTimerMs] = useState(0)
  const loggedErrorMarkersRef = useRef<Set<string>>(new Set())
  const graphPageLimit = config.testGraphLimit ?? DEFAULT_GRAPH_PAGE_LIMIT

  useEffect(() => {
    // Clear legacy oversized keys once (missing schema marker) before any persisted reads.
    ensureLocalStorageSchema()
    setIsClientMounted(true)
  }, [])

  useEffect(() => {
    if (!isClientMounted) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isClientMounted])

  const snapshotsQuery = useQuery({
    queryKey: ['liquidation-silo-snapshots'],
    queryFn: fetchLiquidationSnapshotEntries,
    enabled: isClientMounted,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const snapshotEntries = useMemo(
    () => snapshotsQuery.data ?? [],
    [snapshotsQuery.data]
  )
  const snapshotsReady = snapshotsQuery.isSuccess && snapshotEntries.length > 0
  const snapshotKey = useMemo(() => buildLiquidationSnapshotKey(snapshotEntries), [snapshotEntries])
  const marketsDynamicStorageKey = useMemo(() => `liq:markets:dynamic:v2:${snapshotKey}`, [snapshotKey])
  const marketsCountsStorageKey = useMemo(
    () => `liq:markets:counts:v4:${snapshotKey}:${config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK}`,
    [config.testGraphLimit, snapshotKey]
  )
  const marketsPrefetchStorageKey = useMemo(
    () => `liq:markets:positions-prefetch:v4:${snapshotKey}:${graphPageLimit}`,
    [snapshotKey, graphPageLimit]
  )
  const marketsTimerStorageKey = useMemo(() => `liq:markets:timer:v2:${snapshotKey}`, [snapshotKey])
  const missingMarketRefreshRef = useRef<string | null>(null)
  const wasMarketFetchingRef = useRef(false)

  const [blacklistSelection, setBlacklistSelection] = useState<Map<string, BlacklistBarItem>>(
    () => new Map()
  )

  const staticMarketRows = useMemo(
    () =>
      snapshotEntries.map((row) => ({
        chainId: row.chainId,
        chainKey: row.chainKey,
        chainName: getNetworkDisplayName(row.chainId),
        chainDisplayName: getNetworkShortName(row.chainId),
        chainIconPath: getNetworkIconPath(row.chainId),
        siloAddress: row.siloAddress,
        siloId: row.siloId,
        siloIndex: row.siloIndex ?? null,
        otherSiloAddress: row.otherSilo?.siloAddress ?? null,
        tokenAddress: row.tokenAddress ?? null,
        tokenSymbol: row.tokenSymbol,
        quoteTokenSymbol: row.quoteTokenSymbol ?? row.tokenSymbol ?? null,
        otherTokenAddress: row.otherSilo?.tokenAddress ?? null,
        otherTokenSymbol: row.otherSilo?.tokenSymbol ?? null,
        otherTokenDecimals: row.otherSilo?.tokenDecimals ?? null,
        ltRaw: row.siloConfig?.lt ?? null,
        otherLtRaw: row.otherSilo?.siloConfig?.lt ?? null,
        marketVersion: normalizeSnapshotMarketVersion(row.marketVersion),
        marketTokenPair:
          row.siloIndex === 1
            ? `${row.otherSilo?.tokenSymbol ?? '?'} / ${row.tokenSymbol ?? '?'}`
            : `${row.tokenSymbol ?? '?'} / ${row.otherSilo?.tokenSymbol ?? '?'}`,
        tokenDecimals: row.tokenDecimals,
      })),
    [snapshotEntries]
  )

  const externalPositionsQuery = useQuery({
    queryKey: ['liq', 'positions', 'external', snapshotKey],
    queryFn: () => fetchExternalPositionsData(snapshotEntries.map((row) => row.chainId)),
    enabled: isClientMounted && snapshotsReady,
    staleTime: 0,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  })
  const externalDataVersion = externalPositionsQuery.dataUpdatedAt || 0

  const dynamicStateQuery = useQuery({
    queryKey: ['liq', 'markets', 'dynamic', snapshotKey],
    queryFn: async () => {
      const byChain = new Map<number, typeof snapshotEntries>()
      for (const row of snapshotEntries) {
        if (!byChain.has(row.chainId)) byChain.set(row.chainId, [])
        byChain.get(row.chainId)!.push(row)
      }
      const out = new Map<string, Awaited<ReturnType<typeof fetchMarketsDynamicState>> extends Map<string, infer T> ? T : never>()
      const perChain = await Promise.all(
        Array.from(byChain.entries()).map(async ([chainId, entries]) => ({
          chainId,
          dynamicByMarket: await fetchMarketsDynamicState(chainId, entries),
        }))
      )
      for (const { chainId, dynamicByMarket } of perChain) {
        dynamicByMarket.forEach((dynamic, siloAddress) => {
          out.set(`${chainId}:${siloAddress.toLowerCase()}`, dynamic)
        })
      }
      return out
    },
    enabled: isClientMounted && snapshotsReady,
    initialData: () => {
      if (!isClientMounted) return undefined
      const cached = readPersisted<Array<readonly [string, PersistedDynamicState]>>(marketsDynamicStorageKey)
      return cached ? deserializeDynamicStateMap(cached.data) : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted
        ? readPersisted<Array<readonly [string, PersistedDynamicState]>>(marketsDynamicStorageKey)?.fetchedAt
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const positionsCountQuery = useQuery({
    queryKey: ['liq', 'markets', 'counts', snapshotKey, config.testGraphLimit, externalDataVersion],
    queryFn: async () => {
      const out = new Map<string, number>()
      const v3Markets = snapshotEntries.filter((row) => (row.marketVersion ?? 'v3') === 'v3')
      const countsByChainAndMarket =
        v3Markets.length > 0
          ? await fetchOpenPositionCountsByChainAndMarket(
              v3Markets.map((row) => ({
                chainId: row.chainId,
                marketId: row.siloAddress.toLowerCase(),
              })),
              config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK
            )
          : new Map<string, number>()
      countsByChainAndMarket.forEach((count, key) => out.set(key, count))
      const external = externalPositionsQuery.data
      if (external) {
        snapshotEntries.forEach((row) => {
          if ((row.marketVersion ?? 'v3') !== 'legacy') return
          const key = `${row.chainId}:${row.siloAddress.toLowerCase()}`
          const items = external.byMarketKey.get(key) ?? []
          out.set(key, items.length)
        })
      }
      return out
    },
    enabled: isClientMounted && snapshotsReady,
    initialData: () => {
      if (!isClientMounted) return undefined
      const cached = readPersisted<Array<readonly [string, number]>>(marketsCountsStorageKey)
      return cached
        ? stripLegacyCountsFromCache(new Map<string, number>(cached.data), staticMarketRows)
        : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted ? readPersisted<Array<readonly [string, number]>>(marketsCountsStorageKey)?.fetchedAt : undefined,
    staleTime: MARKET_DATA_STALE_TIME_MS,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const prefetchedMarketPositionsQuery = useQuery({
    queryKey: ['liq', 'markets', 'positions-prefetch', snapshotKey, graphPageLimit, externalDataVersion],
    queryFn: async () => {
      const externalData = externalPositionsQuery.data
      const out = new Map<string, PrefetchedMarketPositionsEntry>()
      const marketChunkSize = config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK
      const v3MarketRefs = staticMarketRows
        .filter((row) => row.marketVersion === 'v3')
        .map((row) => ({
          chainId: row.chainId,
          marketId: row.siloAddress.toLowerCase(),
        }))
      const positionsByChainAndMarket =
        v3MarketRefs.length > 0
          ? await fetchAllOpenPositionsByChainAndMarket(v3MarketRefs, graphPageLimit, marketChunkSize)
          : new Map<string, OpenMarketPosition[]>()
      for (const row of staticMarketRows) {
        const key = `${row.chainId}:${row.siloAddress.toLowerCase()}`
        const items = mergeMarketPositionItems(
          row.chainId,
          row.siloAddress,
          row.marketVersion,
          positionsByChainAndMarket.get(key) ?? [],
          externalData
        )
        if (row.marketVersion === 'legacy') {
          console.info(
            `[positions-legacy] market=${key} source=external count=${items.length} hasExternal=${Boolean(externalData)}`
          )
        }
        const borrowerAddresses = Array.from(
          new Set(items.map((item) => extractBorrowerAddress(item.accountId)).filter(Boolean))
        ) as string[]
        let solvencyByBorrower = new Map<string, boolean>()
        try {
          solvencyByBorrower =
            row.marketVersion === 'legacy'
              ? solvencyMapFromExternalMarket(externalData, key)
              : borrowerAddresses.length > 0
                ? await fetchBorrowersSolvency(row.chainId, row.siloAddress, borrowerAddresses)
                : new Map<string, boolean>()
        } catch (error) {
          console.warn(`[positions] solvency prefetch failed for ${key}; continuing with health-factor counts`, error)
        }
        const ltRatio = parseScaledNumber(resolveEffectiveLtRawForMarket(row), 18)
        let warningCount = 0
        let insolventCount = 0
        for (const item of items) {
          const ltvRatio = parseScaledNumber(item.ltv, 18)
          const healthFactor = computeHealthFactor(ltvRatio, ltRatio)
          const borrowerAddress = extractBorrowerAddress(item.accountId)
          const positionKey = borrowerAddress
            ? buildLiquidationPositionKey(row.chainId, row.siloAddress, borrowerAddress)
            : null
          const externalSolvent = positionKey ? externalData?.byPositionKey.get(positionKey)?.solvent : null
          const isSolvent = externalSolvent ?? (borrowerAddress ? solvencyByBorrower.get(borrowerAddress) : undefined)
          const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
          const isWarning = isWarningHealthFactor(healthFactor, isInsolvent)
          if (isInsolvent) insolventCount += 1
          else if (isWarning) warningCount += 1
        }
        out.set(key, {
          chainId: row.chainId,
          siloAddress: row.siloAddress.toLowerCase(),
          fetchedAt: Date.now(),
          items,
          totalCount: items.length,
          warningCount,
          insolventCount,
          solvencyByBorrower: Array.from(solvencyByBorrower.entries()),
        })
      }
      return out
    },
    enabled: isClientMounted && snapshotsReady,
    initialData: () => {
      if (!isClientMounted) return undefined
      const cached = readPersisted<Array<readonly [string, PrefetchedMarketPositionsEntry]>>(marketsPrefetchStorageKey)
      return cached
        ? stripLegacyMarketsFromPrefetchCache(
            new Map<string, PrefetchedMarketPositionsEntry>(cached.data),
            staticMarketRows
          )
        : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted
        ? readPersisted<Array<readonly [string, PrefetchedMarketPositionsEntry]>>(marketsPrefetchStorageKey)?.fetchedAt
        : undefined,
    staleTime: MARKET_DATA_STALE_TIME_MS,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!dynamicStateQuery.data) return
    writePersisted(marketsDynamicStorageKey, {
      fetchedAt: dynamicStateQuery.dataUpdatedAt || Date.now(),
      data: serializeDynamicStateMap(dynamicStateQuery.data),
    })
  }, [dynamicStateQuery.data, dynamicStateQuery.dataUpdatedAt, marketsDynamicStorageKey])

  useEffect(() => {
    if (!positionsCountQuery.data) return
    writePersisted(marketsCountsStorageKey, {
      fetchedAt: positionsCountQuery.dataUpdatedAt || Date.now(),
      data: Array.from(positionsCountQuery.data.entries()),
    })
  }, [positionsCountQuery.data, positionsCountQuery.dataUpdatedAt, marketsCountsStorageKey])

  useEffect(() => {
    if (!isClientMounted) return
    try {
      const raw = window.localStorage.getItem(marketsTimerStorageKey)
      const parsed = raw ? Number(raw) : 0
      setMarketsTimerMs(Number.isFinite(parsed) && parsed > 0 ? parsed : 0)
    } catch {
      setMarketsTimerMs(0)
    }
  }, [isClientMounted, marketsTimerStorageKey])

  useEffect(() => {
    if (!prefetchedMarketPositionsQuery.data) return
    const fetchedAt = prefetchedMarketPositionsQuery.dataUpdatedAt || Date.now()
    writePersisted(marketsPrefetchStorageKey, {
      fetchedAt,
      data: Array.from(prefetchedMarketPositionsQuery.data.entries()),
    })
    prefetchedMarketPositionsQuery.data.forEach((entry, key) => {
      const [chainIdRaw, siloAddress] = key.split(':')
      const chainId = Number(chainIdRaw)
      if (!Number.isFinite(chainId) || !siloAddress) return
      const marketRow = staticMarketRows.find(
        (row) => row.chainId === chainId && row.siloAddress.toLowerCase() === siloAddress
      )
      if (marketRow?.marketVersion === 'legacy') return
      const pageKey = `liq:positions:list:v3:${chainId}:${siloAddress}:${graphPageLimit}:0`
      writePersisted(pageKey, {
        fetchedAt,
        data: {
          items: entry.items.slice(0, graphPageLimit),
          totalCount: entry.totalCount,
          hasNextPage: entry.totalCount > graphPageLimit,
        },
      })
      writePersisted(`${pageKey}:solvency`, {
        fetchedAt,
        data: entry.solvencyByBorrower,
      })
    })
  }, [
    prefetchedMarketPositionsQuery.data,
    prefetchedMarketPositionsQuery.dataUpdatedAt,
    marketsPrefetchStorageKey,
    graphPageLimit,
    staticMarketRows,
  ])

  useEffect(() => {
    if (!isClientMounted) return
    const marketFetching =
      dynamicStateQuery.isFetching || positionsCountQuery.isFetching || prefetchedMarketPositionsQuery.isFetching
    if (marketFetching) {
      wasMarketFetchingRef.current = true
      return
    }
    if (!wasMarketFetchingRef.current) return
    wasMarketFetchingRef.current = false
    const now = Date.now()
    setMarketsTimerMs(now)
    try {
      window.localStorage.setItem(marketsTimerStorageKey, String(now))
    } catch {
      // ignore storage errors
    }
  }, [
    isClientMounted,
    dynamicStateQuery.isFetching,
    positionsCountQuery.isFetching,
    prefetchedMarketPositionsQuery.isFetching,
    marketsTimerStorageKey,
  ])

  useEffect(() => {
    if (!dynamicStateQuery.isError) return
    const marker = `dynamic:${dynamicStateQuery.errorUpdatedAt}`
    if (loggedErrorMarkersRef.current.has(marker)) return
    loggedErrorMarkersRef.current.add(marker)
    console.group('[positions] live market metrics fetch failed (RPC dynamic state)')
    console.error('queryKey', ['liq', 'markets', 'dynamic', snapshotKey])
    console.error('error dump', toErrorDump(dynamicStateQuery.error))
    console.error('raw error', dynamicStateQuery.error)
    console.groupEnd()
  }, [dynamicStateQuery.isError, dynamicStateQuery.error, dynamicStateQuery.errorUpdatedAt, snapshotKey])

  useEffect(() => {
    if (!positionsCountQuery.isError) return
    const marker = `counts:${positionsCountQuery.errorUpdatedAt}`
    if (loggedErrorMarkersRef.current.has(marker)) return
    loggedErrorMarkersRef.current.add(marker)
    console.group('[positions] live market metrics fetch failed (Graph positions counts)')
    console.error('queryKey', ['liq', 'markets', 'counts', snapshotKey, config.testGraphLimit])
    console.error('error dump', toErrorDump(positionsCountQuery.error))
    console.error('raw error', positionsCountQuery.error)
    const graphError = positionsCountQuery.error as Error & {
      query?: string
      variables?: Record<string, unknown>
    }
    if (graphError.query) {
      console.group('[positions] GraphQL Playground copy/paste')
      console.error('Query:\n' + graphError.query)
      console.error('Variables:\n' + stringifyPretty(graphError.variables ?? {}))
      console.error(
        'Payload (raw POST body):\n' +
          stringifyPretty({
            query: graphError.query,
            variables: graphError.variables ?? {},
          })
      )
      console.groupEnd()
    }
    console.groupEnd()
  }, [
    positionsCountQuery.isError,
    positionsCountQuery.error,
    positionsCountQuery.errorUpdatedAt,
    snapshotKey,
    config.testGraphLimit,
  ])

  useEffect(() => {
    if (!prefetchedMarketPositionsQuery.isError) return
    const marker = `prefetch:${prefetchedMarketPositionsQuery.errorUpdatedAt}`
    if (loggedErrorMarkersRef.current.has(marker)) return
    loggedErrorMarkersRef.current.add(marker)
    console.group('[positions] markets positions prefetch failed')
    console.error('queryKey', ['liq', 'markets', 'positions-prefetch', snapshotKey, graphPageLimit])
    console.error('error dump', toErrorDump(prefetchedMarketPositionsQuery.error))
    console.error('raw error', prefetchedMarketPositionsQuery.error)
    console.groupEnd()
  }, [
    prefetchedMarketPositionsQuery.isError,
    prefetchedMarketPositionsQuery.error,
    prefetchedMarketPositionsQuery.errorUpdatedAt,
    snapshotKey,
    graphPageLimit,
  ])

  const marketRows = useMemo<MarketRow[]>(() => {
    const dynamic = dynamicStateQuery.data ?? new Map()
    const counts = positionsCountQuery.data ?? new Map()
    const prefetched = prefetchedMarketPositionsQuery.data ?? new Map()
    return staticMarketRows.map((row) => {
      const key = `${row.chainId}:${row.siloAddress.toLowerCase()}`
      const otherKey =
        row.otherSiloAddress != null ? `${row.chainId}:${row.otherSiloAddress.toLowerCase()}` : null
      const d = dynamic.get(key)
      const otherD = otherKey != null ? dynamic.get(otherKey) : null
      const prefetch = prefetched.get(key)
      const positionsCount = counts.get(key) ?? prefetch?.totalCount ?? null
      const warningPositionsCount = prefetch?.warningCount ?? null
      const insolventPositionsCount = prefetch?.insolventCount ?? null
      const normalPositionsCount =
        positionsCount == null || warningPositionsCount == null || insolventPositionsCount == null
          ? null
          : Math.max(0, positionsCount - warningPositionsCount - insolventPositionsCount)
      const totalDebt = d?.totalDebt ?? null
      return {
        ...row,
        totalAssets: d?.totalAssets ?? null,
        totalDebt,
        liquidity: d?.liquidity ?? null,
        externalLiquidity: d?.externalLiquidity ?? null,
        hasExternalLiquiditySource: d ? d.hasExternalLiquiditySource : null,
        externalLiquiditySources: d?.externalLiquiditySources ?? null,
        otherTotalAssets: otherD?.totalAssets ?? null,
        otherLiquidity: otherD?.liquidity ?? null,
        otherTotalDebt: otherD?.totalDebt ?? null,
        positionsCount,
        normalPositionsCount,
        warningPositionsCount,
        insolventPositionsCount,
        needsSanityAlert:
          row.marketVersion === 'v3' &&
          totalDebt != null &&
          positionsCount != null &&
          totalDebt > BIGINT_ZERO &&
          positionsCount === 0,
      }
    })
  }, [dynamicStateQuery.data, positionsCountQuery.data, prefetchedMarketPositionsQuery.data, staticMarketRows])
  const dynamicStateData = dynamicStateQuery.data
  const positionsCountData = positionsCountQuery.data
  const prefetchedPositionsData = prefetchedMarketPositionsQuery.data
  const refetchDynamicState = dynamicStateQuery.refetch
  const refetchPositionsCount = positionsCountQuery.refetch
  const refetchPrefetchedPositions = prefetchedMarketPositionsQuery.refetch
  const marketsLastUpdatedAt = marketsTimerMs
  const marketsFreshnessLabel = formatRelativeAge(marketsLastUpdatedAt, nowMs)
  const marketsAgeSeconds = getRelativeAgeSeconds(marketsLastUpdatedAt, nowMs)
  const marketsFreshnessClass = getMarketsFreshnessTextClass(marketsAgeSeconds)

  const selectedChainId = parseIntParam(searchParams.get('chain'))
  const selectedSiloAddress = (searchParams.get('silo') ?? '').trim().toLowerCase()
  const paginationOffsetRaw = parseIntParam(searchParams.get('offset'))
  const paginationOffset = config.testDisablePagination ? 0 : paginationOffsetRaw ?? 0
  const pageLimit = POSITIONS_VIEW_PAGE_LIMIT
  const positionsStorageKey = useMemo(
    () => `liq:positions:list:v3:${selectedChainId ?? 'na'}:${selectedSiloAddress || 'na'}:${pageLimit}:${paginationOffset}`,
    [selectedChainId, selectedSiloAddress, pageLimit, paginationOffset]
  )

  const filteredRows = useMemo(() => {
    const rows = marketRows
    const subset = rows.filter((row) => {
      if (selectedChains.size > 0 && !selectedChains.has(row.chainId)) return false

      if (filters.token.trim()) {
        const query = filters.token.trim().toLowerCase()
        // Primary silo only: paired-silo symbol/address ("other silo") is display-only for search.
        const symbolScope = `${row.tokenSymbol ?? ''} ${row.quoteTokenSymbol ?? ''}`.toLowerCase()
        const addressScope = row.siloAddress.toLowerCase()
        const siloIdScope = row.siloId == null ? '' : String(row.siloId).toLowerCase()
        if (!symbolScope.includes(query) && !addressScope.includes(query) && !siloIdScope.includes(query)) return false
      }
      if (filters.hideZeroPositions && row.positionsCount === 0) return false
      return true
    })

    const sorted = [...subset].sort((a, b) => {
      if (sortColumn === 'positions') {
        const compareTuple = (
          lhs: [number, number, number],
          rhs: [number, number, number]
        ): number => {
          if (lhs[0] !== rhs[0]) return lhs[0] - rhs[0]
          if (lhs[1] !== rhs[1]) return lhs[1] - rhs[1]
          return lhs[2] - rhs[2]
        }
        const lhs: [number, number, number] = [
          a.insolventPositionsCount ?? 0,
          a.warningPositionsCount ?? 0,
          a.positionsCount ?? 0,
        ]
        const rhs: [number, number, number] = [
          b.insolventPositionsCount ?? 0,
          b.warningPositionsCount ?? 0,
          b.positionsCount ?? 0,
        ]
        const cmp = compareTuple(lhs, rhs)
        return sortDirection === 'asc' ? cmp : -cmp
      }
      // Primary-silo fields only; paired-silo sublines (otherTotal*) are display-only and excluded from sort.
      const byColumn: Record<SortColumn, string | number | bigint | null> = {
        siloId: a.siloId,
        chain: a.chainDisplayName,
        token: a.tokenSymbol,
        totalAssets: a.totalAssets,
        liquidity: a.liquidity,
        totalDebt: a.totalDebt,
        positions: a.positionsCount,
      }
      const byColumnB: Record<SortColumn, string | number | bigint | null> = {
        siloId: b.siloId,
        chain: b.chainDisplayName,
        token: b.tokenSymbol,
        totalAssets: b.totalAssets,
        liquidity: b.liquidity,
        totalDebt: b.totalDebt,
        positions: b.positionsCount,
      }
      const cmp = compareValues(byColumn[sortColumn], byColumnB[sortColumn])
      return sortDirection === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [filters, marketRows, selectedChains, sortColumn, sortDirection])

  const hiddenMarketsWithoutPositionsCount = useMemo(() => {
    if (!filters.hideZeroPositions) return 0
    let hidden = 0
    for (const row of marketRows) {
      if (row.positionsCount === 0) hidden += 1
    }
    return hidden
  }, [marketRows, filters.hideZeroPositions])

  useEffect(() => {
    if (snapshotEntries.length === 0) return
    if (!dynamicStateData || !positionsCountData || !prefetchedPositionsData) return
    const hasMissingLiveData = snapshotEntries.some((entry) => {
      const key = `${entry.chainId}:${entry.siloAddress.toLowerCase()}`
      const hasDynamic = dynamicStateData.has(key)
      const hasCount = positionsCountData.has(key)
      const hasPrefetchedPositions = prefetchedPositionsData.has(key)
      return !hasDynamic || !hasCount || !hasPrefetchedPositions
    })
    if (!hasMissingLiveData) {
      if (missingMarketRefreshRef.current === snapshotKey) missingMarketRefreshRef.current = null
      return
    }
    if (missingMarketRefreshRef.current === snapshotKey) return
    missingMarketRefreshRef.current = snapshotKey
    void Promise.all([refetchDynamicState(), refetchPositionsCount(), refetchPrefetchedPositions()])
  }, [
    snapshotEntries,
    snapshotKey,
    dynamicStateData,
    positionsCountData,
    prefetchedPositionsData,
    refetchDynamicState,
    refetchPositionsCount,
    refetchPrefetchedPositions,
  ])

  const availableChainIds = useMemo(
    () => Array.from(new Set(marketRows.map((row) => row.chainId))).sort((a, b) => a - b),
    [marketRows]
  )

  const selectedRow =
    view === 'positions' && selectedChainId != null && selectedSiloAddress
      ? marketRows.find(
          (row) => row.chainId === selectedChainId && row.siloAddress.toLowerCase() === selectedSiloAddress
        ) ?? null
      : null
  const selectedPrefetchedEntry =
    selectedRow != null
      ? prefetchedMarketPositionsQuery.data?.get(`${selectedRow.chainId}:${selectedRow.siloAddress.toLowerCase()}`) ?? null
      : null

  useEffect(() => {
    if (view === 'positions' && selectedRow) return
    setIsRealtimeEnabled(false)
    setCustomRealtimeBorrowers([])
    setRealtimeNextRefreshAtMs(null)
  }, [view, selectedRow])

  useEffect(() => {
    if (isRealtimeEnabled) return
    setRealtimeLtvByBorrower(new Map())
    setSolventFlashByBorrower(new Map())
    prevSolventByBorrowerRef.current = new Map()
    realtimeSolventBaselineSeededRef.current = false
    setCustomRealtimeBorrowers([])
    setRealtimeNextRefreshAtMs(null)
  }, [isRealtimeEnabled])

  const positionsQuery = useQuery({
    queryKey: [
      'liq',
      'positions',
      selectedChainId,
      selectedSiloAddress,
      pageLimit,
      paginationOffset,
      externalDataVersion,
    ],
    queryFn: async () => {
      if (!selectedRow) return { items: [] as OpenMarketPosition[], totalCount: 0, hasNextPage: false }
      if (selectedRow.marketVersion === 'legacy') {
        const allItems = mergeMarketPositionItems(
          selectedRow.chainId,
          selectedRow.siloAddress,
          'legacy',
          [],
          externalPositionsQuery.data
        )
        return {
          items: allItems.slice(paginationOffset, paginationOffset + pageLimit),
          totalCount: allItems.length,
          hasNextPage: paginationOffset + pageLimit < allItems.length,
        }
      }
      const externalData = externalPositionsQuery.data
      const allItems = mergeMarketPositionItems(
        selectedRow.chainId,
        selectedRow.siloAddress,
        'v3',
        await fetchAllOpenPositionsByMarket(selectedRow.chainId, selectedRow.siloAddress, pageLimit),
        externalData
      )
      return {
        items: allItems.slice(paginationOffset, paginationOffset + pageLimit),
        totalCount: allItems.length,
        hasNextPage: paginationOffset + pageLimit < allItems.length,
      }
    },
    enabled: isClientMounted && selectedRow != null,
    initialData: () => {
      if (!isClientMounted || selectedRow?.marketVersion === 'legacy') return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return {
          items: selectedPrefetchedEntry.items,
          totalCount: selectedPrefetchedEntry.totalCount,
          hasNextPage: selectedPrefetchedEntry.totalCount > pageLimit,
        }
      }
      return readPersisted<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }>(positionsStorageKey)?.data
    },
    initialDataUpdatedAt: () => {
      if (!isClientMounted || selectedRow?.marketVersion === 'legacy') return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return selectedPrefetchedEntry.fetchedAt || prefetchedMarketPositionsQuery.dataUpdatedAt || undefined
      }
      return readPersisted<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }>(positionsStorageKey)
        ?.fetchedAt
    },
    staleTime: MARKET_DATA_STALE_TIME_MS,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!positionsQuery.data || selectedRow?.marketVersion === 'legacy') return
    writePersisted(positionsStorageKey, {
      fetchedAt: positionsQuery.dataUpdatedAt || Date.now(),
      data: positionsQuery.data,
    })
  }, [positionsQuery.data, positionsQuery.dataUpdatedAt, positionsStorageKey, selectedRow?.marketVersion])

  useEffect(() => {
    if (!positionsQuery.isError) return
    const marker = `positions-list:${positionsQuery.errorUpdatedAt}`
    if (loggedErrorMarkersRef.current.has(marker)) return
    loggedErrorMarkersRef.current.add(marker)
    console.group('[positions] positions list fetch failed (Graph)')
    console.error('queryKey', ['liq', 'positions', selectedChainId, selectedSiloAddress, pageLimit, paginationOffset])
    console.error('error dump', toErrorDump(positionsQuery.error))
    console.error('raw error', positionsQuery.error)
    const graphError = positionsQuery.error as Error & {
      query?: string
      variables?: Record<string, unknown>
    }
    if (graphError.query) {
      console.group('[positions] GraphQL Playground copy/paste')
      console.error('Query:\n' + graphError.query)
      console.error('Variables:\n' + stringifyPretty(graphError.variables ?? {}))
      console.error(
        'Payload (raw POST body):\n' +
          stringifyPretty({
            query: graphError.query,
            variables: graphError.variables ?? {},
          })
      )
      console.groupEnd()
    }
    console.groupEnd()
  }, [
    positionsQuery.isError,
    positionsQuery.error,
    positionsQuery.errorUpdatedAt,
    selectedChainId,
    selectedSiloAddress,
    pageLimit,
    paginationOffset,
  ])

  const borrowerAddresses = useMemo(
    () =>
      Array.from(
        new Set((positionsQuery.data?.items ?? []).map((row) => extractBorrowerAddress(row.accountId)).filter(Boolean))
      ) as string[],
    [positionsQuery.data?.items]
  )

  const solvencyQuery = useQuery({
    queryKey: ['liq', 'positions', 'solvency', selectedRow?.chainId, selectedRow?.siloAddress?.toLowerCase(), borrowerAddresses.join('|')],
    queryFn: async () => {
      if (!selectedRow) return new Map<string, boolean>()
      return fetchBorrowersSolvency(selectedRow.chainId, selectedRow.siloAddress, borrowerAddresses, {
        preferredProvider: walletProvider,
        preferredChainId: walletChainId,
      })
    },
    enabled:
      isClientMounted &&
      selectedRow != null &&
      selectedRow.marketVersion !== 'legacy' &&
      borrowerAddresses.length > 0,
    initialData: () => {
      if (!isClientMounted || selectedRow?.marketVersion === 'legacy') return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return new Map<string, boolean>(selectedPrefetchedEntry.solvencyByBorrower)
      }
      const storageKey = `${positionsStorageKey}:solvency`
      const cached = readPersisted<Array<readonly [string, boolean]>>(storageKey)
      return cached ? new Map<string, boolean>(cached.data) : undefined
    },
    initialDataUpdatedAt: () => {
      if (!isClientMounted || selectedRow?.marketVersion === 'legacy') return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return selectedPrefetchedEntry.fetchedAt || prefetchedMarketPositionsQuery.dataUpdatedAt || undefined
      }
      return readPersisted<Array<readonly [string, boolean]>>(`${positionsStorageKey}:solvency`)?.fetchedAt
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!solvencyQuery.data || selectedRow?.marketVersion === 'legacy') return
    writePersisted(`${positionsStorageKey}:solvency`, {
      fetchedAt: solvencyQuery.dataUpdatedAt || Date.now(),
      data: Array.from(solvencyQuery.data.entries()),
    })
  }, [solvencyQuery.data, solvencyQuery.dataUpdatedAt, positionsStorageKey, selectedRow?.marketVersion])

  const effectiveLtRaw = useMemo(() => {
    if (!selectedRow) return null
    const isV3 = (selectedRow.siloId ?? 0) > 3000
    if (isV3) return selectedRow.otherLtRaw ?? selectedRow.ltRaw

    // v2 one-way market: exactly one LT is zero, so collateral LT is the non-zero value.
    const thisIsZero = isZeroLt(selectedRow.ltRaw)
    const otherIsZero = isZeroLt(selectedRow.otherLtRaw)
    if (thisIsZero !== otherIsZero) {
      return thisIsZero ? selectedRow.otherLtRaw ?? selectedRow.ltRaw : selectedRow.ltRaw
    }
    return selectedRow.ltRaw
  }, [selectedRow])
  const positionLtRatio = useMemo(() => parseScaledNumber(effectiveLtRaw, 18), [effectiveLtRaw])
  const positionLtLabel = formatPercentCompact(positionLtRatio, 2)
  const positionsLastUpdatedAt = Math.max(positionsQuery.dataUpdatedAt, solvencyQuery.dataUpdatedAt || 0)
  const positionsFreshnessLabel = formatRelativeAge(positionsLastUpdatedAt, nowMs)
  const positionsAgeSeconds = getRelativeAgeSeconds(positionsLastUpdatedAt, nowMs)
  const positionsFreshnessClass = getPositionsFreshnessTextClass(positionsAgeSeconds)
  const positionsTotalRecords = positionsQuery.data?.totalCount ?? (positionsQuery.data?.items ?? []).length
  const positionsCurrentPage = Math.floor(paginationOffset / pageLimit) + 1
  const positionsTotalPages = Math.max(1, Math.ceil(Math.max(positionsTotalRecords, 1) / pageLimit))
  const positionsPageLabel = !config.testDisablePagination ? `Page ${positionsCurrentPage} of ${positionsTotalPages}` : null

  const positionScoreContext = useMemo(
    () => ({
      selectedRow: selectedRow
        ? { chainId: selectedRow.chainId, siloAddress: selectedRow.siloAddress }
        : null,
      positionLtRatio,
      realtimeLtvByBorrower,
      externalByPositionKey: externalPositionsQuery.data?.byPositionKey,
      solvencyByBorrower: new Map<string, boolean>([
        ...(selectedPrefetchedEntry?.solvencyByBorrower ?? []),
        ...Array.from(solvencyQuery.data?.entries() ?? []),
      ]),
    }),
    [
      selectedRow,
      positionLtRatio,
      realtimeLtvByBorrower,
      externalPositionsQuery.data?.byPositionKey,
      selectedPrefetchedEntry?.solvencyByBorrower,
      solvencyQuery.data,
    ]
  )

  const positionItemsForPriorityScale = useMemo(() => {
    if (selectedPrefetchedEntry?.items.length) return selectedPrefetchedEntry.items
    if (selectedRow?.marketVersion === 'legacy') {
      return mergeMarketPositionItems(
        selectedRow.chainId,
        selectedRow.siloAddress,
        'legacy',
        [],
        externalPositionsQuery.data
      )
    }
    return positionsQuery.data?.items ?? []
  }, [
    selectedPrefetchedEntry?.items,
    selectedRow,
    externalPositionsQuery.data,
    positionsQuery.data?.items,
  ])

  const positionPriorityScaleByTier = useMemo((): PositionPriorityScaleByTier => {
    const scoredForScale = positionItemsForPriorityScale.map((item) =>
      scoreOpenMarketPosition(item, positionScoreContext)
    )
    return resolvePositionPriorityScaleByTier(scoredForScale)
  }, [positionItemsForPriorityScale, positionScoreContext])

  const sortedPositionRows = useMemo(() => {
    const rows = positionsQuery.data?.items ?? []
    const scored = rows.map((row) => scoreOpenMarketPosition(row, positionScoreContext))
    scored.sort((a, b) => {
      if (positionsSortColumn === 'priority') {
        const tierCmp =
          positionRiskSortTier(a.isInsolvent, a.isWarning) - positionRiskSortTier(b.isInsolvent, b.isWarning)
        if (tierCmp !== 0) return tierCmp
      }

      const lhs: Record<PositionsSortColumn, number | null> = {
        healthFactor: a.healthFactor,
        priority: a.priority,
        ltv: a.ltvRatio,
        debtValue: a.debtValueNum,
        collateralValue: a.collateralValueNum,
      }
      const rhs: Record<PositionsSortColumn, number | null> = {
        healthFactor: b.healthFactor,
        priority: b.priority,
        ltv: b.ltvRatio,
        debtValue: b.debtValueNum,
        collateralValue: b.collateralValueNum,
      }
      const cmp = compareValues(lhs[positionsSortColumn], rhs[positionsSortColumn])
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return scored
  }, [
    positionsQuery.data?.items,
    positionsSortColumn,
    sortDirection,
    positionScoreContext,
  ])

  const minDebtValueThreshold = useMemo(
    () => parseDecimalFilterInput(positionFilters.minDebtValueInput),
    [positionFilters.minDebtValueInput]
  )

  const hiddenByDebtValueCount = useMemo(() => {
    if (minDebtValueThreshold == null) return 0
    let hidden = 0
    for (const scored of sortedPositionRows) {
      const debt = scored.debtValueNum
      if (debt == null || debt < minDebtValueThreshold) hidden += 1
    }
    return hidden
  }, [sortedPositionRows, minDebtValueThreshold])

  const normalizedBorrowerQuery = useMemo(
    () => normalizeBorrowerSearchText(positionFilters.borrowerAddress),
    [positionFilters.borrowerAddress]
  )

  const filteredPositionRows = useMemo(() => {
    return sortedPositionRows.filter((scored) => {
      if (!positionMatchesBorrowerFilter(scored, normalizedBorrowerQuery)) return false
      if (minDebtValueThreshold != null) {
        const debt = scored.debtValueNum
        if (debt == null || debt < minDebtValueThreshold) return false
      }
      return true
    })
  }, [sortedPositionRows, normalizedBorrowerQuery, minDebtValueThreshold])

  const hotDebtPositionIds = useMemo(
    () =>
      resolveHotValuePositionIds(
        sortedPositionRows.map((scored) => ({
          id: scored.row.id,
          value: scored.debtValueNum,
        }))
      ),
    [sortedPositionRows]
  )

  const hasBorrowerAddressFilter = normalizedBorrowerQuery.length > 0
  const hasDebtValueFilter = minDebtValueThreshold != null

  const positionsCountLabel = useMemo(() => {
    if (hasBorrowerAddressFilter || hasDebtValueFilter) {
      return `${filteredPositionRows.length} of ${sortedPositionRows.length} positions`
    }
    return `${positionsTotalRecords} positions`
  }, [
    hasBorrowerAddressFilter,
    hasDebtValueFilter,
    filteredPositionRows.length,
    sortedPositionRows.length,
    positionsTotalRecords,
  ])

  const solventSummary = useMemo(() => {
    let insolvent = 0
    let warning = 0
    for (const row of filteredPositionRows) {
      if (row.isInsolvent) insolvent += 1
      else if (row.isWarning) warning += 1
    }
    const normal = Math.max(0, filteredPositionRows.length - insolvent - warning)
    return { normal, warning, insolvent }
  }, [filteredPositionRows])

  const hiddenSolventSummary = useMemo(() => {
    if (!hasBorrowerAddressFilter && !hasDebtValueFilter) return null

    let hiddenTotal = 0
    let hiddenInsolvent = 0
    let hiddenWarning = 0

    for (const row of sortedPositionRows) {
      const matchesBorrower = positionMatchesBorrowerFilter(row, normalizedBorrowerQuery)
      const matchesDebt =
        minDebtValueThreshold == null ||
        (row.debtValueNum != null && row.debtValueNum >= minDebtValueThreshold)
      const isVisible = matchesBorrower && matchesDebt
      if (isVisible) continue

      hiddenTotal += 1
      if (row.isInsolvent) hiddenInsolvent += 1
      else if (row.isWarning) hiddenWarning += 1
    }

    if (hiddenTotal === 0) return null
    const hiddenNormal = Math.max(0, hiddenTotal - hiddenInsolvent - hiddenWarning)
    return { normal: hiddenNormal, warning: hiddenWarning, insolvent: hiddenInsolvent }
  }, [
    hasBorrowerAddressFilter,
    hasDebtValueFilter,
    sortedPositionRows,
    normalizedBorrowerQuery,
    minDebtValueThreshold,
  ])

  const filteredRealtimeBorrowersToMonitor = useMemo(() => {
    const rows = positionsQuery.data?.items ?? []
    const addresses: string[] = []
    for (const row of rows) {
      const borrowerAddress = extractBorrowerAddress(row.accountId)
      if (!borrowerAddress) continue
      const hasLiveLtv = realtimeLtvByBorrower.has(borrowerAddress)
      const effectiveLtvRaw = resolveEffectiveLtvRaw(row, borrowerAddress, realtimeLtvByBorrower)
      const externalKey = selectedRow
        ? buildLiquidationPositionKey(selectedRow.chainId, selectedRow.siloAddress, borrowerAddress)
        : null
      const external = externalKey ? externalPositionsQuery.data?.byPositionKey.get(externalKey) : undefined
      const effectiveSolvent = resolvePositionSolvent({
        effectiveLtvRaw,
        positionLtRatio,
        externalSolvent: external?.solvent,
        rpcSolvent: solvencyQuery.data?.get(borrowerAddress),
        preferLtvDerivation: hasLiveLtv,
      })
      const rowForMonitor = hasLiveLtv ? { ...row, ltv: effectiveLtvRaw } : row
      if (shouldMonitorPositionInRealtime({ row: rowForMonitor, positionLtRatio, isSolvent: effectiveSolvent, nowMs })) {
        addresses.push(borrowerAddress)
      }
    }
    return Array.from(new Set(addresses))
  }, [
    positionsQuery.data?.items,
    positionLtRatio,
    solvencyQuery.data,
    nowMs,
    selectedRow,
    externalPositionsQuery.data,
    realtimeLtvByBorrower,
  ])
  const customRealtimeBorrowersStable = useMemo(
    () => Array.from(new Set(customRealtimeBorrowers)),
    [customRealtimeBorrowers]
  )
  const realtimeBorrowersToMonitor = useMemo(
    () => Array.from(new Set([...filteredRealtimeBorrowersToMonitor, ...customRealtimeBorrowersStable])),
    [filteredRealtimeBorrowersToMonitor, customRealtimeBorrowersStable]
  )
  const realtimeMonitorKey = useMemo(
    () => realtimeBorrowersToMonitor.join('|'),
    [realtimeBorrowersToMonitor]
  )
  const realtimeBorrowersToMonitorStable = useMemo(
    () => (realtimeMonitorKey ? realtimeMonitorKey.split('|') : []),
    [realtimeMonitorKey]
  )
  const realtimeMonitoredBorrowerSet = useMemo(() => new Set(realtimeBorrowersToMonitor), [realtimeBorrowersToMonitor])
  const realtimeSecondsUntilRefresh = useMemo(() => {
    if (!isRealtimeEnabled || realtimeNextRefreshAtMs == null) return null
    return Math.min(
      REALTIME_REFRESH_INTERVAL_SECONDS,
      Math.max(0, Math.ceil((realtimeNextRefreshAtMs - nowMs) / 1000))
    )
  }, [isRealtimeEnabled, realtimeNextRefreshAtMs, nowMs])

  useEffect(() => {
    if (!isRealtimeEnabled || !selectedRow) {
      realtimeSolventBaselineSeededRef.current = false
      return
    }
    if (realtimeSolventBaselineSeededRef.current) return
    const seed = new Map<string, boolean>()
    for (const row of positionsQuery.data?.items ?? []) {
      const borrowerAddress = extractBorrowerAddress(row.accountId)
      if (!borrowerAddress) continue
      const externalKey = buildLiquidationPositionKey(selectedRow.chainId, selectedRow.siloAddress, borrowerAddress)
      const external = externalKey ? externalPositionsQuery.data?.byPositionKey.get(externalKey) : undefined
      const baseline = resolvePositionSolvent({
        effectiveLtvRaw: row.ltv,
        positionLtRatio,
        externalSolvent: external?.solvent,
        rpcSolvent: solvencyQuery.data?.get(borrowerAddress),
        preferLtvDerivation: false,
      })
      if (baseline != null) seed.set(borrowerAddress, baseline)
    }
    prevSolventByBorrowerRef.current = seed
    realtimeSolventBaselineSeededRef.current = true
  }, [
    isRealtimeEnabled,
    selectedRow,
    positionsQuery.data?.items,
    positionLtRatio,
    solvencyQuery.data,
    externalPositionsQuery.data,
  ])

  useEffect(() => {
    if (!isRealtimeEnabled || realtimeLtvByBorrower.size === 0 || positionLtRatio == null) return
    const transitions = new Map<string, 'improved' | 'worsened'>()
    realtimeLtvByBorrower.forEach((ltvRaw, borrowerAddress) => {
      const nextSolvent = deriveSolventFromLtvRatio(parseScaledNumber(ltvRaw, 18), positionLtRatio)
      if (nextSolvent == null) return
      const prevSolvent = prevSolventByBorrowerRef.current.get(borrowerAddress)
      if (prevSolvent != null && prevSolvent !== nextSolvent) {
        transitions.set(borrowerAddress, nextSolvent ? 'improved' : 'worsened')
      }
      prevSolventByBorrowerRef.current.set(borrowerAddress, nextSolvent)
    })
    // Highlight persists until the next live refresh tick (replaced/cleared each cycle).
    setSolventFlashByBorrower(transitions)
  }, [isRealtimeEnabled, realtimeLtvByBorrower, positionLtRatio])

  useEffect(() => {
    if (!isRealtimeEnabled || !selectedRow) return
    let cancelled = false
    let timer: number | null = null
    void getSiloLensAddressForChain(selectedRow.chainId).then((siloLensAddress) => {
      if (cancelled) return
      const siloLensExplorerUrl = siloLensAddress
        ? getExplorerAddressUrl(selectedRow.chainId, siloLensAddress)
        : null
      console.info('[positions-live] enabled', {
        chainId: selectedRow.chainId,
        market: selectedRow.siloAddress,
        siloLensAddress,
        siloLensExplorerUrl,
      })
    })

    const run = async () => {
      if (cancelled) return
      try {
        if (realtimeBorrowersToMonitorStable.length > 0) {
          const nextLtvByBorrower = await fetchBorrowersLtvFromSiloLens(
            selectedRow.chainId,
            selectedRow.siloAddress,
            realtimeBorrowersToMonitorStable,
            {
              preferredProvider: walletProvider,
              preferredChainId: walletChainId,
            }
          )
          console.debug('[positions-live] tick', {
            chainId: selectedRow.chainId,
            market: selectedRow.siloAddress,
            monitoredBorrowers: realtimeBorrowersToMonitorStable.length,
            refreshedBorrowers: nextLtvByBorrower.size,
          })
          nextLtvByBorrower.forEach((ltvRaw18, borrowerAddress) => {
            console.info(`[positions-live] borrower: ${borrowerAddress} ltv: ${formatLtvPercentFromRaw18(ltvRaw18)}`)
          })
          if (!cancelled) {
            setRealtimeLtvByBorrower((prev) => (areStringMapsEqual(prev, nextLtvByBorrower) ? prev : nextLtvByBorrower))
          }
        } else if (!cancelled) {
          console.debug('[positions-live] tick', {
            chainId: selectedRow.chainId,
            market: selectedRow.siloAddress,
            monitoredBorrowers: 0,
            refreshedBorrowers: 0,
          })
          setRealtimeLtvByBorrower((prev) => (prev.size === 0 ? prev : new Map()))
        }
      } finally {
        if (cancelled) return
        setRealtimeNextRefreshAtMs(Date.now() + REALTIME_REFRESH_INTERVAL_SECONDS * 1000)
        timer = window.setTimeout(run, REALTIME_REFRESH_INTERVAL_SECONDS * 1000)
      }
    }

    void run()
    return () => {
      cancelled = true
      setRealtimeNextRefreshAtMs(null)
      if (timer != null) window.clearTimeout(timer)
    }
  }, [isRealtimeEnabled, selectedRow, realtimeMonitorKey, realtimeBorrowersToMonitorStable, walletProvider, walletChainId])

  const toggleSort = (column: SortColumn) => {
    replaceSearchParams((params) => {
      const current = parseMarketSortColumn(params.get('sort')) ?? DEFAULT_MARKET_SORT_COLUMN
      const currentDir = parseSortDirection(params.get('dir'))
      params.set('sort', column)
      if (current !== column) params.set('dir', 'desc')
      else params.set('dir', currentDir === 'asc' ? 'desc' : 'asc')
    })
  }

  const updateFilter = (key: keyof ColumnFilters, value: string | boolean) => {
    replaceSearchParams((params) => {
      if (key === 'token') {
        const trimmed = String(value).trim()
        if (trimmed) params.set('q', trimmed)
        else params.delete('q')
        return
      }
      if (value === true) params.delete('hideEmpty')
      else params.set('hideEmpty', '0')
    })
  }

  const toggleChainFilter = (chainId: number) => {
    replaceSearchParams((params) => {
      const next = new Set(selectedChains)
      if (next.has(chainId)) next.delete(chainId)
      else next.add(chainId)
      const serialized = serializeChainsParam(next)
      if (serialized) params.set('chains', serialized)
      else params.delete('chains')
    })
  }

  const clearChainFilter = () => {
    replaceSearchParams((params) => {
      params.delete('chains')
    })
  }

  const setPositionBorrowerFilter = (value: string) => {
    replaceSearchParams((params) => {
      if (value.trim()) params.set('borrower', value)
      else params.delete('borrower')
    })
  }

  const setPositionMinDebtFilter = (value: string) => {
    replaceSearchParams((params) => {
      writeMinDebtUrlParam(params, value)
    })
  }

  const sortIndicator = (column: SortColumn): string => {
    if (sortColumn !== column) return ''
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  const positionsSortIndicator = (column: PositionsSortColumn): string => {
    if (positionsSortColumn !== column) return ''
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  const togglePositionsSort = (column: PositionsSortColumn) => {
    replaceSearchParams((params) => {
      const current = parsePositionsSortColumn(params.get('sort')) ?? DEFAULT_POSITIONS_SORT_COLUMN
      const currentDir = parseSortDirection(params.get('dir'))
      params.set('sort', column)
      if (current === column) {
        params.set('dir', currentDir === 'asc' ? 'desc' : 'asc')
      } else {
        params.set('dir', 'desc')
      }
    })
  }

  const syncMarketCachesFromPositionsRefresh = async () => {
    if (!selectedRow || selectedChainId == null || !selectedSiloAddress) return
    const marketKey = `${selectedRow.chainId}:${selectedRow.siloAddress.toLowerCase()}`
    // Re-download the legacy positions file (cache-busted) so a manual refresh reflects the latest data.
    const externalData =
      selectedRow.marketVersion === 'legacy'
        ? (await externalPositionsQuery.refetch()).data ?? externalPositionsQuery.data
        : externalPositionsQuery.data
    const allItems =
      selectedRow.marketVersion === 'legacy'
        ? mergeMarketPositionItems(
            selectedRow.chainId,
            selectedRow.siloAddress,
            'legacy',
            [],
            externalData
          )
        : mergeMarketPositionItems(
            selectedRow.chainId,
            selectedRow.siloAddress,
            'v3',
            await fetchAllOpenPositionsByMarket(selectedRow.chainId, selectedRow.siloAddress, graphPageLimit),
            externalData
          )
    const allBorrowerAddresses = Array.from(
      new Set(allItems.map((item) => extractBorrowerAddress(item.accountId)).filter(Boolean))
    ) as string[]
    const solvencyByBorrower =
      selectedRow.marketVersion === 'legacy'
        ? solvencyMapFromExternalMarket(externalData, marketKey)
        : allBorrowerAddresses.length > 0
          ? await fetchBorrowersSolvency(selectedRow.chainId, selectedRow.siloAddress, allBorrowerAddresses, {
              preferredProvider: walletProvider,
              preferredChainId: walletChainId,
            })
          : new Map<string, boolean>()

    let warningCount = 0
    let insolventCount = 0
    for (const item of allItems) {
      const ltvRatio = parseScaledNumber(item.ltv, 18)
      const healthFactor = computeHealthFactor(ltvRatio, positionLtRatio)
      const borrowerAddress = extractBorrowerAddress(item.accountId)
      const externalSolventKey = borrowerAddress
        ? buildLiquidationPositionKey(selectedRow.chainId, selectedRow.siloAddress, borrowerAddress)
        : null
      const externalSolvent = externalSolventKey
        ? externalData?.byPositionKey.get(externalSolventKey)?.solvent
        : null
      const isSolvent = externalSolvent ?? (borrowerAddress ? solvencyByBorrower.get(borrowerAddress) : undefined)
      const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
      const isWarning = isWarningHealthFactor(healthFactor, isInsolvent)
      if (isInsolvent) insolventCount += 1
      else if (isWarning) warningCount += 1
    }

    queryClient.setQueryData<Map<string, number>>(
      ['liq', 'markets', 'counts', snapshotKey, config.testGraphLimit, externalDataVersion],
      (prev) => {
        const next = new Map(prev ?? [])
        next.set(marketKey, allItems.length)
        return next
      }
    )

    queryClient.setQueryData<Map<string, PrefetchedMarketPositionsEntry>>(
      ['liq', 'markets', 'positions-prefetch', snapshotKey, graphPageLimit, externalDataVersion],
      (prev) => {
        const next = new Map(prev ?? [])
        next.set(marketKey, {
          chainId: selectedRow.chainId,
          siloAddress: selectedRow.siloAddress.toLowerCase(),
          fetchedAt: Date.now(),
          items: allItems,
          totalCount: allItems.length,
          warningCount,
          insolventCount,
          solvencyByBorrower: Array.from(solvencyByBorrower.entries()),
        })
        return next
      }
    )

    queryClient.setQueryData<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }>(
      ['liq', 'positions', selectedChainId, selectedSiloAddress, pageLimit, paginationOffset, externalDataVersion],
      {
        items: allItems.slice(paginationOffset, paginationOffset + pageLimit),
        totalCount: allItems.length,
        hasNextPage: paginationOffset + pageLimit < allItems.length,
      }
    )

    queryClient.setQueryData<Map<string, boolean>>(
      ['liq', 'positions', 'solvency', selectedRow.chainId, selectedRow.siloAddress.toLowerCase(), borrowerAddresses.join('|')],
      new Map(solvencyByBorrower)
    )
  }

  const openPositionsView = (row: MarketRow) => {
    replaceSearchParams((params) => {
      params.set('view', 'positions')
      params.set('chain', String(row.chainId))
      params.set('silo', row.siloAddress)
      params.delete('offset')
      params.delete('borrower')
      const posSort = parsePositionsSortColumn(params.get('sort'))
      params.set('sort', posSort ?? DEFAULT_POSITIONS_SORT_COLUMN)
      if (!posSort) params.set('dir', 'desc')
    })
  }

  const backToMarkets = () => {
    replaceSearchParams((params) => {
      params.delete('view')
      params.delete('chain')
      params.delete('silo')
      params.delete('offset')
      params.delete('borrower')
      params.delete('minDebt')
      const marketSort = parseMarketSortColumn(params.get('sort'))
      params.set('sort', marketSort ?? DEFAULT_MARKET_SORT_COLUMN)
      if (!marketSort) params.set('dir', 'desc')
    })
  }

  const jumpPage = (nextOffset: number) => {
    if (config.testDisablePagination) return
    const safe = Math.max(0, nextOffset)
    replaceSearchParams((params) => {
      params.set('offset', String(safe))
    })
  }

  const toggleBlacklistSelection = useCallback((row: MarketRow) => {
    const key = marketRowKey(row)
    setBlacklistSelection((prev) => {
      const next = new Map(prev)
      if (next.has(key)) {
        next.delete(key)
        return next
      }
      next.set(key, {
        chainKey: row.chainKey,
        chainId: row.chainId,
        siloAddress: row.siloAddress.toLowerCase(),
        siloId: row.siloId,
        tokenSymbol: row.tokenSymbol,
        chainIconPath: row.chainIconPath,
        chainDisplayName: row.chainDisplayName,
      })
      return next
    })
  }, [])

  const blacklistBarItems = useMemo(() => Array.from(blacklistSelection.values()), [blacklistSelection])

  if (!isClientMounted || snapshotsQuery.isLoading || (snapshotsQuery.isFetching && !snapshotsQuery.data)) {
    return (
      <div className="silo-page px-4 py-8 sm:px-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
            ← Home
          </Link>
        </div>
        <div className="silo-panel p-6">
          <h1 className="text-xl font-semibold silo-text-main m-0 mb-2">Positions</h1>
          <p className="text-sm silo-text-soft m-0">Loading market snapshots…</p>
        </div>
      </div>
    )
  }

  if (snapshotsQuery.isError || !snapshotsReady) {
    const detail =
      snapshotsQuery.error instanceof Error
        ? snapshotsQuery.error.message
        : 'Remote silo snapshots failed to load.'
    return (
      <div className="silo-page px-4 py-8 sm:px-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
            ← Home
          </Link>
        </div>
        <div className="silo-panel p-6 space-y-3">
          <h1 className="text-xl font-semibold silo-text-main m-0">Positions</h1>
          <p className="text-sm silo-text-soft m-0">
            Could not load silo market snapshots from the data branch. Set repository / local env{' '}
            <code className="text-xs">NEXT_PUBLIC_LIQ_SILOS_BASE_URL</code> to the raw GitHub root of{' '}
            <code className="text-xs">legacy-positions</code> (no path suffix), then reload.
          </p>
          <p className="text-xs silo-text-faint m-0 break-words">{detail}</p>
          <button type="button" className="silo-btn-secondary" onClick={() => void snapshotsQuery.refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="silo-page px-4 py-8 sm:px-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
          ← Home
        </Link>
      </div>

      {view === 'positions' && selectedRow ? (
        <div className="space-y-4">
          <div className="silo-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="inline-flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold silo-text-main m-0">
                  {selectedRow.tokenSymbol ?? selectedRow.quoteTokenSymbol ?? 'Unknown'}
                </h2>
                <span className="ml-6 text-sm text-[var(--silo-text)]">
                  total assets{' '}
                  <FormattedDecimal
                    value={formatMetricFixed(selectedRow.totalAssets, selectedRow.tokenDecimals, 4)}
                    fractionDigits={4}
                  />
                </span>
                <span className="text-sm text-[var(--silo-text)]">
                  total debt{' '}
                  <FormattedDecimal
                    value={formatMetricFixed(selectedRow.totalDebt, selectedRow.tokenDecimals, 4)}
                    fractionDigits={4}
                  />
                </span>
              </div>
              <button type="button" onClick={backToMarkets} className="silo-btn-secondary">
                Back to markets
              </button>
            </div>
            <p className="text-xs silo-text-soft m-0 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                {selectedRow.chainIconPath ? (
                  <Image
                    src={selectedRow.chainIconPath}
                    alt={`${selectedRow.chainDisplayName} icon`}
                    width={12}
                    height={12}
                    className="rounded-sm align-middle"
                  />
                ) : null}
                <span>{selectedRow.chainName}</span>
              </span>
              <span className="silo-text-faint">•</span>
              <span>#{selectedRow.siloId ?? '—'}</span>
              <span className="silo-text-faint">•</span>
              <a
                href={getExplorerAddressUrl(selectedRow.chainId, selectedRow.siloAddress)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
                title={selectedRow.siloAddress}
              >
                <span>{shortenAddress(selectedRow.siloAddress)}</span>
              </a>
              <InlineCopyIconButton
                value={selectedRow.siloAddress}
                copyLabel="Copy market address"
                className="text-xs ml-1 silo-text-soft hover:silo-text-main"
              />
              <span className="ml-4">{selectedRow.marketTokenPair}</span>
              <span className="ml-4 text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)] font-semibold">LT {positionLtLabel}</span>
              <span className="ml-4">{selectedRow.marketVersion === 'legacy' ? 'Legacy Market' : 'V3 Market'}</span>
            </p>
          </div>

          <div className="silo-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[12rem] sm:max-w-md">
                <span className="block text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
                  Borrower address
                </span>
                <div className="relative">
                  <input
                    className="silo-input silo-input--sm w-full pr-7 font-mono"
                    placeholder="Full or partial address"
                    value={positionFilters.borrowerAddress}
                    onChange={(e) => setPositionBorrowerFilter(e.target.value)}
                  />
                  {positionFilters.borrowerAddress.trim() ? (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-3xl leading-none text-[color-mix(in_srgb,var(--silo-text)_45%,transparent)] hover:text-[color-mix(in_srgb,var(--silo-text)_75%,transparent)]"
                      onClick={() => setPositionBorrowerFilter('')}
                      aria-label="Clear borrower address filter"
                      title="Clear"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>
              <div className="flex items-end gap-2 shrink-0">
                <label className="block w-28">
                  <span className="block text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
                    Min debt value
                  </span>
                  <div className="relative">
                    <input
                      className="silo-input silo-input--sm w-full pr-7 tabular-nums"
                      inputMode="decimal"
                      placeholder={DEFAULT_POSITION_MIN_DEBT_VALUE}
                      value={positionFilters.minDebtValueInput}
                      onChange={(e) => setPositionMinDebtFilter(e.target.value)}
                    />
                    {positionFilters.minDebtValueInput.trim() ? (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-3xl leading-none text-[color-mix(in_srgb,var(--silo-text)_45%,transparent)] hover:text-[color-mix(in_srgb,var(--silo-text)_75%,transparent)]"
                        onClick={() => setPositionMinDebtFilter('')}
                        aria-label="Clear min debt value filter"
                        title="Clear"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </label>
                <span className="pb-2 text-xs silo-text-soft whitespace-nowrap tabular-nums">
                  ({hiddenByDebtValueCount} hidden)
                </span>
              </div>
            </div>
          </div>

          {positionsQuery.isLoading ? (
            <div className="silo-panel p-5">
              <p className="text-sm silo-text-soft m-0">Loading positions…</p>
            </div>
          ) : positionsQuery.isError ? (
            <div className="silo-alert silo-alert-error">
              Failed to load positions for this market. Please retry.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-1">
                <span className="text-xs text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]">
                  {positionsCountLabel}
                  {positionsPageLabel ? ` • ${positionsPageLabel}` : ''}
                </span>
                <div className="inline-flex items-center gap-3">
                  <span className={`text-xs ${positionsFreshnessClass}`}>Fetched {positionsFreshnessLabel}</span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-10 w-10 rounded-md text-2xl silo-text-soft hover:silo-text-main disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      void syncMarketCachesFromPositionsRefresh()
                    }}
                    disabled={positionsQuery.isFetching || solvencyQuery.isFetching}
                    aria-label="Refresh positions data"
                    title="Refresh"
                  >
                    <span aria-hidden>⟳</span>
                  </button>
                </div>
              </div>
              <div className="silo-panel p-0 overflow-hidden">
              {solvencyQuery.isError ? (
                <div className="silo-alert silo-alert-warning m-3">
                  Failed to load solvency flags for some borrowers. LT-based warnings are still visible.
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[color-mix(in_srgb,var(--silo-soft-purple)_40%,var(--silo-surface-2))]">
                    <tr>
                      <th
                        className={`text-left px-4 py-3 font-semibold ${isRealtimeEnabled ? POSITIONS_LIVE_STALE_COLUMN_CLASS : ''}`}
                        title={isRealtimeEnabled ? 'Not updated during LIVE refresh' : undefined}
                      >
                        Borrower
                      </th>
                      <th
                        className={`text-right px-4 py-3 font-semibold ${isRealtimeEnabled ? POSITIONS_LIVE_STALE_COLUMN_CLASS : ''}`}
                        title={isRealtimeEnabled ? 'Not updated during LIVE refresh' : undefined}
                      >
                        <button type="button" onClick={() => togglePositionsSort('collateralValue')} className="w-full text-right">
                          Collateral Value{positionsSortIndicator('collateralValue')}
                        </button>
                      </th>
                      <th
                        className={`text-right px-4 py-3 font-semibold ${isRealtimeEnabled ? POSITIONS_LIVE_STALE_COLUMN_CLASS : ''}`}
                        title={isRealtimeEnabled ? 'Not updated during LIVE refresh' : undefined}
                      >
                        <button type="button" onClick={() => togglePositionsSort('debtValue')} className="w-full text-right">
                          Debt Value{positionsSortIndicator('debtValue')}
                        </button>
                      </th>
                      <th
                        className="text-left px-4 py-3 font-semibold"
                        title={isRealtimeEnabled ? 'Updated during LIVE refresh (with Health Factor)' : undefined}
                      >
                        <span className="inline-flex items-center gap-2">
                          <button type="button" onClick={() => togglePositionsSort('ltv')}>
                            LTV{positionsSortIndicator('ltv')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (isRealtimeEnabled) {
                                setIsRealtimeEnabled(false)
                                return
                              }
                              setIsRealtimeEnabled(true)
                            }}
                            disabled={positionsQuery.isFetching || solvencyQuery.isFetching}
                            className={`text-[10px] font-semibold tracking-wide transition-colors ${
                              isRealtimeEnabled
                                ? 'text-[color-mix(in_srgb,var(--silo-text)_96%,#000000)]'
                                : 'text-[color-mix(in_srgb,var(--silo-text)_26%,transparent)]'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            aria-pressed={isRealtimeEnabled}
                            aria-label="Toggle realtime monitoring"
                            title="Toggle realtime monitoring"
                          >
                            LIVE{isRealtimeEnabled && realtimeSecondsUntilRefresh != null ? ` ${realtimeSecondsUntilRefresh}s` : ''}
                          </button>
                        </span>
                      </th>
                      <th
                        className="text-left px-4 py-3 font-semibold"
                        title={isRealtimeEnabled ? 'Updated during LIVE refresh (derived from LTV)' : undefined}
                      >
                        <div className="inline-flex flex-col items-start leading-tight">
                          <button type="button" onClick={() => togglePositionsSort('healthFactor')}>
                            Health Factor{positionsSortIndicator('healthFactor')}
                          </button>
                          <span className="mt-1 inline-flex items-center gap-2 text-[11px] font-normal tabular-nums">
                            <span className={solventSummary.normal === 0 ? 'silo-text-soft opacity-30' : 'silo-text-soft'}>
                              {solventSummary.normal}
                            </span>
                            <span
                              className={
                                solventSummary.warning === 0
                                  ? 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)] opacity-30'
                                  : 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)]'
                              }
                            >
                              {solventSummary.warning}
                            </span>
                            <span
                              className={
                                solventSummary.insolvent === 0
                                  ? 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)] opacity-30'
                                  : 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)]'
                              }
                            >
                              {solventSummary.insolvent}
                            </span>
                          </span>
                          {hiddenSolventSummary ? (
                            <span className="mt-1 inline-flex items-center justify-between w-full gap-3 text-[11px] font-normal tabular-nums">
                              <span className="inline-flex items-center gap-2">
                                <span className={hiddenSolventSummary.normal === 0 ? 'silo-text-soft opacity-30' : 'silo-text-soft'}>
                                  {hiddenSolventSummary.normal}
                                </span>
                                <span
                                  className={
                                    hiddenSolventSummary.warning === 0
                                      ? 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)] opacity-30'
                                      : 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)]'
                                  }
                                >
                                  {hiddenSolventSummary.warning}
                                </span>
                                <span
                                  className={
                                    hiddenSolventSummary.insolvent === 0
                                      ? 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)] opacity-30'
                                      : 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)]'
                                  }
                                >
                                  {hiddenSolventSummary.insolvent}
                                </span>
                              </span>
                              <span className="silo-text-soft">hidden</span>
                            </span>
                          ) : null}
                        </div>
                      </th>
                      <th
                        className="text-right px-4 py-3 font-semibold"
                        title="Debt value × health factor; insolvent and warning rows stay on top"
                      >
                        <button type="button" onClick={() => togglePositionsSort('priority')}>
                          Priority{positionsSortIndicator('priority')}
                        </button>
                      </th>
                      <th
                        className={`text-left px-4 py-3 font-semibold ${isRealtimeEnabled ? POSITIONS_LIVE_STALE_COLUMN_CLASS : ''}`}
                        title={isRealtimeEnabled ? 'Not updated during LIVE refresh' : undefined}
                      >
                        Age
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositionRows.map(
                      ({
                        row,
                        effectiveLtvRaw,
                        healthFactor,
                        priority,
                        isSolvent,
                        isInsolvent,
                        isWarning,
                        hasLiveLtv,
                        borrowerAddress,
                      }) => {
                      const isRealtimeMonitored =
                        isRealtimeEnabled && Boolean(borrowerAddress && realtimeMonitoredBorrowerSet.has(borrowerAddress))
                      const canAddRealtimeMonitor =
                        isRealtimeEnabled && Boolean(borrowerAddress && !realtimeMonitoredBorrowerSet.has(borrowerAddress))
                      const isNearLt = isWarning
                      const priorityScale = priorityScaleForRiskTier(
                        positionPriorityScaleByTier,
                        isInsolvent,
                        isWarning
                      )
                      const hasLtMismatch =
                        !hasLiveLtv &&
                        isSolvent != null &&
                        healthFactor != null &&
                        ((isSolvent === false && healthFactor < 1) || (isSolvent === true && healthFactor >= 1))
                      const solventFlash = borrowerAddress ? solventFlashByBorrower.get(borrowerAddress) : undefined
                      const solventFlashClass =
                        solventFlash === 'worsened'
                          ? 'bg-[color-mix(in_srgb,var(--silo-danger)_6%,transparent)]'
                          : solventFlash === 'improved'
                            ? 'bg-[color-mix(in_srgb,var(--silo-success)_6%,transparent)]'
                            : ''
                      const rowClassName = [
                        'border-t border-[var(--silo-border)]',
                        solventFlashClass,
                        isInsolvent
                          ? 'text-[color-mix(in_srgb,var(--silo-danger)_80%,#5b1322)]'
                          : isNearLt
                            ? 'text-[color-mix(in_srgb,var(--silo-warning)_80%,#5a3b12)]'
                            : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      const symbolToneClass = isInsolvent
                        ? 'text-[11px] text-[color-mix(in_srgb,var(--silo-danger)_62%,#5b1322)]'
                        : isNearLt
                          ? 'text-[11px] text-[color-mix(in_srgb,var(--silo-warning)_52%,#5a3b12)]'
                          : 'text-[11px] silo-text-soft'
                      const staleColumnClass = isRealtimeEnabled ? POSITIONS_LIVE_STALE_COLUMN_CLASS : ''
                      const liveMetricClass =
                        isRealtimeEnabled && hasLiveLtv ? 'transition-opacity' : isRealtimeEnabled ? 'opacity-70 transition-opacity' : ''
                      return (
                        <Fragment key={row.id}>
                          <tr className={rowClassName}>
                            <td className={`px-4 py-3 font-mono ${staleColumnClass}`}>
                              <div className="inline-flex items-center gap-2">
                                {borrowerAddress ? (
                                  <a
                                    href={getExplorerAddressUrl(selectedRow.chainId, borrowerAddress)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="hover:underline"
                                    title={borrowerAddress}
                                  >
                                    {shortenAddress(borrowerAddress)}
                                  </a>
                                ) : (
                                  <span>{shortenAddress(row.accountId)}</span>
                                )}
                                {borrowerAddress ? (
                                  <InlineCopyIconButton
                                    value={borrowerAddress}
                                    copyLabel="Copy borrower address"
                                    className="text-xs silo-text-soft hover:silo-text-main"
                                  />
                                ) : null}
                                {borrowerAddress ? (
                                  <Link
                                    href={`/user?user=${borrowerAddress}&address=${selectedRow.siloAddress}&chain=${selectedRow.chainId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-xs silo-text-soft hover:silo-text-main"
                                    title="View borrower on the User page"
                                    aria-label="View borrower on the User page"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                  </Link>
                                ) : null}
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right ${staleColumnClass}`}>
                              <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5 w-full tabular-nums leading-none">
                                <span className="inline-flex items-baseline gap-1">
                                  <FormattedDecimal
                                    value={formatScaledValue(row.collateralValue, 18, 2)}
                                    fractionDigits={2}
                                  />
                                </span>
                                {row.collateralValue ? (
                                  <span className={symbolToneClass}>
                                    {selectedRow.quoteTokenSymbol ?? selectedRow.tokenSymbol ?? ''}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className={`px-4 py-3 text-right ${staleColumnClass}`}>
                              <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5 w-full tabular-nums leading-none">
                                <span className="inline-flex items-baseline gap-1">
                                  {hotDebtPositionIds.has(row.id) ? <HotValueFlame /> : null}
                                  <FormattedDecimal
                                    value={formatScaledValue(row.debtValue, 18, 2)}
                                    fractionDigits={2}
                                  />
                                </span>
                                {row.debtValue ? (
                                  <span className={symbolToneClass}>
                                    {selectedRow.quoteTokenSymbol ?? selectedRow.tokenSymbol ?? ''}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className={`px-4 py-3 ${liveMetricClass}`}>
                              <span className="inline-flex items-center gap-1.5">
                                {isRealtimeMonitored ? (
                                  <span
                                    className="inline-block h-2 w-2 rounded-full bg-[var(--silo-success)] animate-pulse"
                                    aria-label="Realtime monitoring active for this position"
                                    title="Realtime monitoring active for this position"
                                  />
                                ) : canAddRealtimeMonitor && borrowerAddress ? (
                                  <button
                                    type="button"
                                    className="inline-block h-2 w-2 rounded-full border border-[color-mix(in_srgb,var(--silo-text)_42%,transparent)] bg-[color-mix(in_srgb,var(--silo-text)_28%,transparent)] hover:bg-[color-mix(in_srgb,var(--silo-text)_44%,transparent)] transition-colors"
                                    onClick={() =>
                                      setCustomRealtimeBorrowers((prev) =>
                                        prev.includes(borrowerAddress) ? prev : [...prev, borrowerAddress]
                                      )
                                    }
                                    aria-label="Add position to realtime monitoring"
                                    title="Add position to realtime monitoring"
                                  />
                                ) : null}
                                <PositionLtvDisplay raw={effectiveLtvRaw} />
                              </span>
                            </td>
                            <td className={`px-4 py-3 ${liveMetricClass}`}>{formatHealthFactor(healthFactor)}</td>
                            <td className={`px-4 py-3 text-right ${liveMetricClass}`}>
                              <PositionPriorityTicks
                                priority={priority}
                                minPriority={priorityScale.min}
                                maxPriority={priorityScale.max}
                                isInsolvent={isInsolvent}
                                isWarning={isWarning}
                              />
                            </td>
                            <td className={`px-4 py-3 ${staleColumnClass}`}>{formatPositionAge(row.lastUpdatedTimestamp, nowMs)}</td>
                          </tr>
                          {hasLtMismatch ? (
                            <tr className="border-t border-[var(--silo-border)]">
                              <td colSpan={7} className="px-4 py-2 text-xs text-[color-mix(in_srgb,var(--silo-warning)_88%,#5a3b12)]">
                                Warning: `isSolvent` and Health Factor threshold are divergent for this borrower (possible rounding or pricing mismatch).
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                    {(positionsQuery.data?.items ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 text-sm silo-text-soft">
                          No open positions returned for this market.
                        </td>
                      </tr>
                    ) : filteredPositionRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-4 text-sm silo-text-soft">
                          No positions match the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {!config.testDisablePagination ? (
                <div className="border-t border-[var(--silo-border)] px-4 py-3 flex items-center justify-between">
                  <span className="text-xs silo-text-soft">
                    {positionsPageLabel}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="silo-btn-secondary"
                      disabled={paginationOffset <= 0}
                      onClick={() => jumpPage(Math.max(0, paginationOffset - pageLimit))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="silo-btn-secondary"
                      disabled={!positionsQuery.data?.hasNextPage}
                      onClick={() => jumpPage(paginationOffset + pageLimit)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {dynamicStateQuery.isError || positionsCountQuery.isError || prefetchedMarketPositionsQuery.isError ? (
            <div className="silo-alert silo-alert-error">
              Failed to load some live market metrics. Static data is visible; use Refresh to retry (see console error dump).
            </div>
          ) : null}
            <>
              <div className="silo-panel p-4 sm:p-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="grid grid-cols-1 gap-3 w-full">
                    <label className="block">
                      <span className="block text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
                        Search
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-10 gap-3 items-center">
                        <div className="relative sm:col-span-3">
                          <input
                            className="silo-input silo-input--sm min-w-[120px] w-full pr-7"
                            placeholder="Symbol, silo address, or silo ID"
                            value={filters.token}
                            onChange={(e) => updateFilter('token', e.target.value)}
                          />
                          {filters.token.trim() ? (
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-3xl leading-none text-[color-mix(in_srgb,var(--silo-text)_45%,transparent)] hover:text-[color-mix(in_srgb,var(--silo-text)_75%,transparent)]"
                              onClick={() => updateFilter('token', '')}
                              aria-label="Clear search"
                              title="Clear search"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                        <label className="inline-flex items-center gap-2 text-xs silo-text-soft sm:col-span-7">
                          <input
                            type="checkbox"
                            checked={filters.hideZeroPositions}
                            onChange={(e) => updateFilter('hideZeroPositions', e.target.checked)}
                          />
                          <span>
                            Hide markets without positions
                            <span className="silo-text-faint"> ({hiddenMarketsWithoutPositionsCount} hidden)</span>
                          </span>
                        </label>
                      </div>
                    </label>
                    <div>
                      <span className="block text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
                        Network
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {availableChainIds.map((chainId) => {
                          const isSelected = selectedChains.has(chainId)
                          const iconPath = getNetworkIconPath(chainId)
                          return (
                            <button
                              key={chainId}
                              type="button"
                              className="silo-btn-secondary text-xs inline-flex items-center gap-2"
                              aria-pressed={isSelected}
                              onClick={() => toggleChainFilter(chainId)}
                            >
                              {iconPath ? (
                                <Image
                                  src={iconPath}
                                  alt={`${getNetworkShortName(chainId)} icon`}
                                  width={14}
                                  height={14}
                                  className="rounded-sm"
                                />
                              ) : null}
                              <span>{getNetworkShortName(chainId)}</span>
                            </button>
                          )
                        })}
                        <button
                          type="button"
                          className="silo-btn-secondary text-xs"
                          aria-pressed={selectedChains.size === 0}
                          onClick={clearChainFilter}
                        >
                          All networks
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {dynamicStateQuery.isFetching || positionsCountQuery.isFetching || prefetchedMarketPositionsQuery.isFetching ? (
                  <p className="text-xs silo-text-soft mt-1 mb-0">Loading live metrics in background…</p>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-3 px-1">
                <span className="text-xs text-[color-mix(in_srgb,var(--silo-text)_74%,#1f2430)]">
                  {filteredRows.length} markets
                </span>
                <div className="inline-flex items-center gap-3">
                  <p className={`text-xs mb-0 ${marketsFreshnessClass}`}>Fetched {marketsFreshnessLabel}</p>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-10 w-10 rounded-md text-2xl silo-text-soft hover:silo-text-main disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      void Promise.all([
                        dynamicStateQuery.refetch(),
                        positionsCountQuery.refetch(),
                        prefetchedMarketPositionsQuery.refetch(),
                      ])
                    }}
                    disabled={
                      dynamicStateQuery.isFetching ||
                      positionsCountQuery.isFetching ||
                      prefetchedMarketPositionsQuery.isFetching
                    }
                    aria-label="Refresh markets data"
                    title="Refresh"
                  >
                    <span aria-hidden>⟳</span>
                  </button>
                </div>
              </div>
              <div className="silo-panel p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[color-mix(in_srgb,var(--silo-soft-purple)_40%,var(--silo-surface-2))]">
                    <tr>
                      <th className="text-left px-3 py-3 font-semibold w-[52px]" aria-label="Network column" />
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('siloId')}>
                          Silo ID{sortIndicator('siloId')}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('token')}>
                          Token{sortIndicator('token')}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('totalAssets')}>
                          Total Assets{sortIndicator('totalAssets')}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('totalDebt')}>
                          Total Debt{sortIndicator('totalDebt')}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('liquidity')}>
                          Liquidity{sortIndicator('liquidity')}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold">External Liquidity</th>
                      <th className="text-right px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('positions')}>
                          Positions{sortIndicator('positions')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <FragmentRow
                        key={`${row.chainId}:${row.siloAddress}`}
                        row={row}
                        isBlacklistSelected={blacklistSelection.has(marketRowKey(row))}
                        onToggleBlacklist={() => toggleBlacklistSelection(row)}
                        isDynamicLoading={
                          !isClientMounted || dynamicStateQuery.isLoading || dynamicStateQuery.isFetching
                        }
                        isPrefetchLoading={
                          !isClientMounted ||
                          prefetchedMarketPositionsQuery.isLoading ||
                          prefetchedMarketPositionsQuery.isFetching
                        }
                        hasDynamicError={dynamicStateQuery.isError}
                        hasPrefetchError={prefetchedMarketPositionsQuery.isError}
                        onOpenPositions={() => openPositionsView(row)}
                      />
                    ))}
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-5 text-sm silo-text-soft">
                          {marketRows.length === 0 ? 'No markets available in snapshot.' : 'No markets match this filter.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
            </>
            <BlacklistMarketsBar
              items={blacklistBarItems}
              onClear={() => setBlacklistSelection(new Map())}
              onRemoveItem={(key) => {
                setBlacklistSelection((prev) => {
                  const next = new Map(prev)
                  next.delete(key)
                  return next
                })
              }}
              copyToClipboard={copyToClipboard}
            />
        </div>
      )}
    </div>
  )
}

function FragmentRow({
  row,
  onOpenPositions,
  isBlacklistSelected,
  onToggleBlacklist,
  isDynamicLoading,
  isPrefetchLoading,
  hasDynamicError,
  hasPrefetchError,
}: {
  row: MarketRow
  onOpenPositions: () => void
  isBlacklistSelected: boolean
  onToggleBlacklist: () => void
  isDynamicLoading: boolean
  isPrefetchLoading: boolean
  hasDynamicError: boolean
  hasPrefetchError: boolean
}) {
  const normalCount = row.normalPositionsCount ?? 0
  const warningCount = row.warningPositionsCount ?? 0
  const insolventCount = row.insolventPositionsCount ?? 0
  const showLiquidityStressAlert =
    row.liquidity !== null &&
    row.totalDebt !== null &&
    row.liquidity === BIGINT_ZERO &&
    row.totalDebt > BIGINT_ZERO &&
    !(row.hasExternalLiquiditySource === true && row.externalLiquidity != null && row.externalLiquidity > BIGINT_ZERO)
  const hasRiskyPositions = warningCount > 0 || insolventCount > 0
  const liquidityStressAlertCount: 1 | 2 = hasRiskyPositions ? 2 : 1
  const liquidityStressAlertTone: 'danger' | 'warning' = hasRiskyPositions ? 'danger' : 'warning'
  const rowBgClass = isBlacklistSelected
    ? 'bg-[color-mix(in_srgb,var(--silo-danger)_10%,var(--silo-surface))] hover:bg-[color-mix(in_srgb,var(--silo-danger)_14%,var(--silo-surface))]'
    : 'hover:bg-[color-mix(in_srgb,var(--silo-soft-purple)_18%,var(--silo-surface))]'
  const marketRole = resolveSiloMarketRole(row.ltRaw, row.otherLtRaw)
  const otherMarketRole = resolveSiloMarketRole(row.otherLtRaw, row.ltRaw)

  return (
    <>
      <tr className={`border-t border-[var(--silo-border)] ${rowBgClass}`}>
        <td className="px-4 py-3">
          <div className="inline-flex items-center gap-2">
            {row.chainIconPath ? (
              <Image
                src={row.chainIconPath}
                alt={`${row.chainDisplayName} icon`}
                width={16}
                height={16}
                className="rounded-sm"
              />
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-mono break-all m-0">
            <span className="inline-flex items-center gap-1.5">
              <a
                href={getExplorerAddressUrl(row.chainId, row.siloAddress)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--silo-text)] hover:underline"
              >
                {shortenSiloAddress(row.siloAddress)}
              </a>
              <InlineCopyIconButton
                value={row.siloAddress}
                copyLabel="Copy silo address"
                className="text-xs silo-text-soft hover:silo-text-main"
              />
            </span>
            {row.otherSiloAddress ? (
              <>
                {' '}
                <span className="inline-flex items-center gap-1">
                  <a
                    href={getExplorerAddressUrl(row.chainId, row.otherSiloAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs silo-text-faint hover:underline"
                  >
                    other silo
                  </a>
                  <InlineCopyIconButton
                    value={row.otherSiloAddress}
                    copyLabel="Copy other silo address"
                    className="text-xs silo-text-faint hover:silo-text-main"
                  />
                </span>
              </>
            ) : null}
          </p>
          <div className="text-xs mt-1 inline-flex items-center gap-1.5 flex-wrap">
            <span className="silo-text-soft">#{row.siloId ?? '—'}</span>
            <span className="silo-text-faint">• {row.marketTokenPair}</span>
            <BlacklistTrashButton selected={isBlacklistSelected} onToggle={onToggleBlacklist} />
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-col items-start">
            <div className="inline-flex items-center gap-1.5">
              {marketRole ? <SiloMarketRoleIcon role={marketRole} /> : null}
              {row.tokenAddress ? (
                <a
                  href={getExplorerAddressUrl(row.chainId, row.tokenAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                  title={row.tokenAddress}
                >
                  {row.tokenSymbol ?? 'Unknown'}
                </a>
              ) : (
                <span>{row.tokenSymbol ?? 'Unknown'}</span>
              )}
              {row.tokenAddress ? (
                <InlineCopyIconButton
                  value={row.tokenAddress}
                  copyLabel="Copy token address"
                  className="text-xs silo-text-soft hover:silo-text-main"
                />
              ) : null}
            </div>
            {row.otherTokenSymbol ? (
              <div className="text-xs mt-1 silo-text-faint inline-flex items-center gap-1.5">
                {otherMarketRole ? <SiloMarketRoleIcon role={otherMarketRole} /> : null}
                {row.otherTokenAddress ? (
                  <a
                    href={getExplorerAddressUrl(row.chainId, row.otherTokenAddress)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                    title={row.otherTokenAddress}
                  >
                    {row.otherTokenSymbol}
                  </a>
                ) : (
                  <span>{row.otherTokenSymbol}</span>
                )}
                {row.otherTokenAddress ? (
                  <InlineCopyIconButton
                    value={row.otherTokenAddress}
                    copyLabel="Copy other token address"
                    className="text-xs silo-text-faint hover:silo-text-main"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.totalAssets == null
            ? isDynamicLoading || !hasDynamicError
              ? <InlineLoadingHint />
              : '—'
            : <FormattedDecimal value={formatMetric(row.totalAssets, row.tokenDecimals)} />}
          <OtherSiloMetricSubline
            value={row.otherTotalAssets}
            decimals={row.otherTokenDecimals}
            enabled={row.otherSiloAddress != null}
            isLoading={isDynamicLoading}
            hasError={hasDynamicError}
            styledFraction
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.totalDebt == null
            ? (isDynamicLoading || !hasDynamicError ? <InlineLoadingHint /> : '—')
            : <FormattedDecimal value={formatMetric(row.totalDebt, row.tokenDecimals)} />}
          <OtherSiloMetricSubline
            value={row.otherTotalDebt}
            decimals={row.otherTokenDecimals}
            enabled={row.otherSiloAddress != null}
            isLoading={isDynamicLoading}
            hasError={hasDynamicError}
            styledFraction
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums overflow-visible">
          <div className="relative w-full">
            <div className="text-right">
              {row.liquidity == null
                ? isDynamicLoading || !hasDynamicError
                  ? <InlineLoadingHint />
                  : '—'
                : <FormattedDecimal value={formatMetric(row.liquidity, row.tokenDecimals)} />}
            </div>
            {showLiquidityStressAlert ? (
              <span
                title={
                  hasRiskyPositions
                    ? 'Zero primary liquidity with outstanding debt; warning or insolvent positions'
                    : 'Zero primary liquidity with outstanding debt'
                }
                aria-label={
                  hasRiskyPositions
                    ? 'Zero liquidity with debt; risky positions present'
                    : 'Zero liquidity with debt'
                }
              >
                <LiquidityStressAlertMarkers count={liquidityStressAlertCount} tone={liquidityStressAlertTone} />
              </span>
            ) : null}
          </div>
          <OtherSiloMetricSubline
            value={row.otherLiquidity}
            decimals={row.otherTokenDecimals}
            enabled={row.otherSiloAddress != null}
            isLoading={isDynamicLoading}
            hasError={hasDynamicError}
            styledFraction
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.hasExternalLiquiditySource === false ? (
            'N/A'
          ) : row.externalLiquiditySources != null && row.externalLiquiditySources.length > 0 ? (
            row.externalLiquiditySources.map((source) => (
              <div
                key={source.sourceAddress}
                className="mt-1 tabular-nums inline-flex flex-col items-end w-full"
              >
                <span className="text-sm text-[var(--silo-text)]">
                  <FormattedDecimal value={formatWholeTokenMetric(source.amount, row.tokenDecimals)} />
                </span>
                <a
                  href={getExplorerAddressUrl(row.chainId, source.sourceAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs silo-text-faint hover:underline"
                  title={source.sourceAddress}
                >
                  {formatExternalSourceName(source.version)}
                </a>
              </div>
            ))
          ) : row.externalLiquidity == null ? (
            isDynamicLoading || !hasDynamicError ? <InlineLoadingHint /> : '—'
          ) : (
            <FormattedDecimal value={formatWholeTokenMetric(row.externalLiquidity, row.tokenDecimals)} />
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <button
            type="button"
            onClick={onOpenPositions}
            className="inline-flex items-center gap-2 font-semibold hover:underline"
            title="Open positions"
          >
            <span className="text-[var(--silo-text)]">
              {row.normalPositionsCount == null
                ? isPrefetchLoading || !hasPrefetchError
                  ? <InlineLoadingHint />
                  : '—'
                : normalCount}
            </span>
            <span className={warningCount === 0 ? 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)] opacity-30' : 'text-[color-mix(in_srgb,var(--silo-warning)_75%,#5a3b12)]'}>
              {row.warningPositionsCount == null
                ? isPrefetchLoading || !hasPrefetchError
                  ? <InlineLoadingHint />
                  : warningCount
                : warningCount}
            </span>
            <span className={insolventCount === 0 ? 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)] opacity-30' : 'text-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)]'}>
              {row.insolventPositionsCount == null
                ? isPrefetchLoading || !hasPrefetchError
                  ? <InlineLoadingHint />
                  : insolventCount
                : insolventCount}
            </span>
          </button>
        </td>
      </tr>
      {row.needsSanityAlert ? (
        <tr className="border-t border-[var(--silo-border)] bg-[color-mix(in_srgb,var(--silo-danger)_10%,var(--silo-surface))]">
          <td colSpan={8} className="px-4 py-2 text-xs text-[color-mix(in_srgb,var(--silo-danger)_75%,var(--silo-text))]">
            Sanity check: Graph returns zero open positions while on-chain debt is greater than zero.
          </td>
        </tr>
      ) : null}
    </>
  )
}

export default function PositionsPage() {
  return (
    <Suspense
      fallback={
        <div className="silo-page px-4 py-8 sm:px-6 max-w-7xl mx-auto">
          <p className="text-sm silo-text-soft m-0">Loading…</p>
        </div>
      }
    >
      <PositionsPageInner />
    </Suspense>
  )
}
