'use client'

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getExplorerAddressUrl,
  getNetworkDisplayName,
  getNetworkIconPath,
  getNetworkShortName,
} from '@/utils/networks'
import { getLiquidationSnapshotEntries, getLiquidationSnapshotConfig } from '@/utils/liquidationSnapshot'
import {
  fetchAllOpenPositionsByMarket,
  fetchAllOpenPositionsByChainAndMarket,
  fetchOpenPositionCountsByChainAndMarket,
  fetchOpenPositionsByMarket,
  type OpenMarketPosition,
} from '@/utils/liquidationGraph'
import { fetchBorrowersSolvency, fetchMarketsDynamicState } from '@/utils/liquidationRpc'
import { formatUnits } from 'ethers'

type MarketRow = {
  chainId: number
  chainName: string
  chainDisplayName: string
  chainIconPath: string | null
  siloAddress: string
  siloId: number | null
  siloIndex: 0 | 1 | null
  otherSiloAddress: string | null
  tokenSymbol: string | null
  quoteTokenSymbol: string | null
  otherTokenSymbol: string | null
  ltRaw: string | null
  otherLtRaw: string | null
  marketTokenPair: string
  tokenDecimals: number | null
  totalAssets: bigint | null
  liquidity: bigint | null
  totalDebt: bigint | null
  positionsCount: number | null
  warningPositionsCount: number | null
  insolventPositionsCount: number | null
  needsSanityAlert: boolean
}

const DEFAULT_GRAPH_PAGE_LIMIT = 1000
const DEFAULT_POSITIONS_COUNT_CHUNK = 40
const BIGINT_ZERO = BigInt(0)

type SortColumn =
  | 'siloId'
  | 'chain'
  | 'token'
  | 'totalAssets'
  | 'liquidity'
  | 'totalDebt'
  | 'positions'

type SortDirection = 'asc' | 'desc'
type PositionsSortColumn = 'healthFactor' | 'ltv' | 'debtValue' | 'collateralValue'

type ColumnFilters = {
  token: string
  hideZeroPositions: boolean
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

function formatPositionLtv(raw: string | null): string {
  const n = parseScaledNumber(raw, 18)
  if (n == null) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function formatHealthFactor(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, {
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

function extractBorrowerAddress(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase()
  const suffix = /(0x[0-9a-fA-F]{40})$/.exec(trimmed)
  return suffix ? suffix[1].toLowerCase() : null
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

function formatMetric(value: bigint | null, decimals: number | null): string {
  if (value == null) return '—'
  const parsed = Number(formatUnits(value, decimals ?? 18))
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
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

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  await navigator.clipboard.writeText(value)
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
    } satisfies PersistedDynamicState,
  ] as const)
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
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const config = getLiquidationSnapshotConfig()
  const [sortColumn, setSortColumn] = useState<SortColumn>('positions')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [positionsSortColumn, setPositionsSortColumn] = useState<PositionsSortColumn>('healthFactor')
  const [positionsSortDirection, setPositionsSortDirection] = useState<SortDirection>('desc')
  const [selectedChains, setSelectedChains] = useState<Set<number>>(new Set())
  const [filters, setFilters] = useState<ColumnFilters>({
    token: '',
    hideZeroPositions: true,
  })
  const [isClientMounted, setIsClientMounted] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [marketsTimerMs, setMarketsTimerMs] = useState(0)
  const loggedErrorMarkersRef = useRef<Set<string>>(new Set())
  const graphPageLimit = config.testGraphLimit ?? DEFAULT_GRAPH_PAGE_LIMIT

  useEffect(() => {
    setIsClientMounted(true)
  }, [])

  useEffect(() => {
    if (!isClientMounted) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isClientMounted])

  const snapshotEntries = useMemo(() => getLiquidationSnapshotEntries(), [])
  const snapshotKey = useMemo(
    () => snapshotEntries.map((row) => `${row.chainId}:${row.siloAddress.toLowerCase()}`).join('|'),
    [snapshotEntries]
  )
  const marketsDynamicStorageKey = useMemo(() => `liq:markets:dynamic:v1:${snapshotKey}`, [snapshotKey])
  const marketsCountsStorageKey = useMemo(
    () => `liq:markets:counts:v1:${snapshotKey}:${config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK}`,
    [config.testGraphLimit, snapshotKey]
  )
  const marketsPrefetchStorageKey = useMemo(
    () => `liq:markets:positions-prefetch:v1:${snapshotKey}:${graphPageLimit}`,
    [snapshotKey, graphPageLimit]
  )
  const marketsTimerStorageKey = useMemo(() => `liq:markets:timer:v1:${snapshotKey}`, [snapshotKey])
  const missingMarketRefreshRef = useRef<string | null>(null)
  const wasMarketFetchingRef = useRef(false)

  const staticMarketRows = useMemo(
    () =>
      snapshotEntries.map((row) => ({
        chainId: row.chainId,
        chainName: getNetworkDisplayName(row.chainId),
        chainDisplayName: getNetworkShortName(row.chainId),
        chainIconPath: getNetworkIconPath(row.chainId),
        siloAddress: row.siloAddress,
        siloId: row.siloId,
        siloIndex: row.siloIndex ?? null,
        otherSiloAddress: row.otherSilo?.siloAddress ?? null,
        tokenSymbol: row.tokenSymbol,
        quoteTokenSymbol: row.quoteTokenSymbol ?? row.tokenSymbol ?? null,
        otherTokenSymbol: row.otherSilo?.tokenSymbol ?? null,
        ltRaw: row.siloConfig?.lt ?? null,
        otherLtRaw: row.otherSilo?.siloConfig?.lt ?? null,
        marketTokenPair:
          row.siloIndex === 1
            ? `${row.otherSilo?.tokenSymbol ?? '?'} / ${row.tokenSymbol ?? '?'}`
            : `${row.tokenSymbol ?? '?'} / ${row.otherSilo?.tokenSymbol ?? '?'}`,
        tokenDecimals: row.tokenDecimals,
      })),
    [snapshotEntries]
  )

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
    enabled: isClientMounted && snapshotEntries.length > 0,
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
    queryKey: ['liq', 'markets', 'counts', snapshotKey, config.testGraphLimit],
    queryFn: async () => {
      const out = new Map<string, number>()
      const countsByChainAndMarket = await fetchOpenPositionCountsByChainAndMarket(
        snapshotEntries.map((row) => ({
          chainId: row.chainId,
          marketId: row.siloAddress.toLowerCase(),
        })),
        config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK
      )
      countsByChainAndMarket.forEach((count, key) => out.set(key, count))
      return out
    },
    enabled: isClientMounted && snapshotEntries.length > 0,
    initialData: () => {
      if (!isClientMounted) return undefined
      const cached = readPersisted<Array<readonly [string, number]>>(marketsCountsStorageKey)
      return cached ? new Map<string, number>(cached.data) : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted ? readPersisted<Array<readonly [string, number]>>(marketsCountsStorageKey)?.fetchedAt : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const prefetchedMarketPositionsQuery = useQuery({
    queryKey: ['liq', 'markets', 'positions-prefetch', snapshotKey, graphPageLimit],
    queryFn: async () => {
      const out = new Map<string, PrefetchedMarketPositionsEntry>()
      const marketChunkSize = config.testGraphLimit ?? DEFAULT_POSITIONS_COUNT_CHUNK
      const positionsByChainAndMarket = await fetchAllOpenPositionsByChainAndMarket(
        staticMarketRows.map((row) => ({
          chainId: row.chainId,
          marketId: row.siloAddress.toLowerCase(),
        })),
        graphPageLimit,
        marketChunkSize
      )
      for (const row of staticMarketRows) {
        const key = `${row.chainId}:${row.siloAddress.toLowerCase()}`
        const items = positionsByChainAndMarket.get(key) ?? []
        const borrowerAddresses = Array.from(
          new Set(items.map((item) => extractBorrowerAddress(item.accountId)).filter(Boolean))
        ) as string[]
        const solvencyByBorrower =
          borrowerAddresses.length > 0
            ? await fetchBorrowersSolvency(row.chainId, row.siloAddress, borrowerAddresses)
            : new Map<string, boolean>()
        const ltRatio = parseScaledNumber(resolveEffectiveLtRawForMarket(row), 18)
        let warningCount = 0
        let insolventCount = 0
        for (const item of items) {
          const ltvRatio = parseScaledNumber(item.ltv, 18)
          const healthFactor = ltvRatio != null && ltRatio != null && ltRatio > 0 ? ltvRatio / ltRatio : null
          const borrowerAddress = extractBorrowerAddress(item.accountId)
          const isSolvent = borrowerAddress ? solvencyByBorrower.get(borrowerAddress) : undefined
          const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
          const isWarning = !isInsolvent && healthFactor != null && healthFactor >= 0.9
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
    enabled: isClientMounted && snapshotEntries.length > 0,
    initialData: () => {
      if (!isClientMounted) return undefined
      const cached = readPersisted<Array<readonly [string, PrefetchedMarketPositionsEntry]>>(marketsPrefetchStorageKey)
      return cached ? new Map<string, PrefetchedMarketPositionsEntry>(cached.data) : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted
        ? readPersisted<Array<readonly [string, PrefetchedMarketPositionsEntry]>>(marketsPrefetchStorageKey)?.fetchedAt
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
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
      const pageKey = `liq:positions:list:v1:${chainId}:${siloAddress}:${graphPageLimit}:0`
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
  }, [prefetchedMarketPositionsQuery.data, prefetchedMarketPositionsQuery.dataUpdatedAt, marketsPrefetchStorageKey, graphPageLimit])

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
      const d = dynamic.get(key)
      const prefetch = prefetched.get(key)
      const positionsCount = counts.get(key) ?? prefetch?.totalCount ?? null
      const totalDebt = d?.totalDebt ?? null
      return {
        ...row,
        totalAssets: d?.totalAssets ?? null,
        liquidity: d?.liquidity ?? null,
        totalDebt,
        positionsCount,
        warningPositionsCount: prefetch?.warningCount ?? null,
        insolventPositionsCount: prefetch?.insolventCount ?? null,
        needsSanityAlert: totalDebt != null && positionsCount != null && totalDebt > BIGINT_ZERO && positionsCount === 0,
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
  const view = searchParams.get('view') === 'positions' ? 'positions' : 'markets'
  const paginationOffsetRaw = parseIntParam(searchParams.get('offset'))
  const paginationOffset = config.testDisablePagination ? 0 : paginationOffsetRaw ?? 0
  const pageLimit = config.testDisablePagination ? graphPageLimit : graphPageLimit
  const positionsStorageKey = useMemo(
    () => `liq:positions:list:v1:${selectedChainId ?? 'na'}:${selectedSiloAddress || 'na'}:${pageLimit}:${paginationOffset}`,
    [selectedChainId, selectedSiloAddress, pageLimit, paginationOffset]
  )

  const filteredRows = useMemo(() => {
    const rows = marketRows
    const subset = rows.filter((row) => {
      if (selectedChains.size > 0 && !selectedChains.has(row.chainId)) return false

      if (filters.token.trim()) {
        const tokenFilter = filters.token.trim().toLowerCase()
        const tokenScope = `${row.tokenSymbol ?? ''} ${row.otherTokenSymbol ?? ''}`.toLowerCase()
        if (!tokenScope.includes(tokenFilter)) return false
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

  const positionsQuery = useQuery({
    queryKey: ['liq', 'positions', selectedChainId, selectedSiloAddress, pageLimit, paginationOffset],
    queryFn: async () => {
      if (!selectedRow) return { items: [] as OpenMarketPosition[], totalCount: 0, hasNextPage: false }
      return fetchOpenPositionsByMarket(selectedRow.chainId, selectedRow.siloAddress, pageLimit, paginationOffset)
    },
    enabled: isClientMounted && selectedRow != null,
    initialData: () => {
      if (!isClientMounted) return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return {
          items: selectedPrefetchedEntry.items.slice(0, pageLimit),
          totalCount: selectedPrefetchedEntry.totalCount,
          hasNextPage: selectedPrefetchedEntry.totalCount > pageLimit,
        }
      }
      return readPersisted<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }>(positionsStorageKey)?.data
    },
    initialDataUpdatedAt: () =>
      isClientMounted
        ? paginationOffset === 0 && selectedPrefetchedEntry
          ? selectedPrefetchedEntry.fetchedAt || prefetchedMarketPositionsQuery.dataUpdatedAt || undefined
          : readPersisted<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }>(positionsStorageKey)
              ?.fetchedAt
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!positionsQuery.data) return
    writePersisted(positionsStorageKey, {
      fetchedAt: positionsQuery.dataUpdatedAt || Date.now(),
      data: positionsQuery.data,
    })
  }, [positionsQuery.data, positionsQuery.dataUpdatedAt, positionsStorageKey])

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
      return fetchBorrowersSolvency(selectedRow.chainId, selectedRow.siloAddress, borrowerAddresses)
    },
    enabled: isClientMounted && selectedRow != null && borrowerAddresses.length > 0,
    initialData: () => {
      if (!isClientMounted) return undefined
      if (paginationOffset === 0 && selectedPrefetchedEntry) {
        return new Map<string, boolean>(selectedPrefetchedEntry.solvencyByBorrower)
      }
      const storageKey = `${positionsStorageKey}:solvency`
      const cached = readPersisted<Array<readonly [string, boolean]>>(storageKey)
      return cached ? new Map<string, boolean>(cached.data) : undefined
    },
    initialDataUpdatedAt: () =>
      isClientMounted
        ? paginationOffset === 0 && selectedPrefetchedEntry
          ? selectedPrefetchedEntry.fetchedAt || prefetchedMarketPositionsQuery.dataUpdatedAt || undefined
          : readPersisted<Array<readonly [string, boolean]>>(`${positionsStorageKey}:solvency`)?.fetchedAt
        : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  useEffect(() => {
    if (!solvencyQuery.data) return
    writePersisted(`${positionsStorageKey}:solvency`, {
      fetchedAt: solvencyQuery.dataUpdatedAt || Date.now(),
      data: Array.from(solvencyQuery.data.entries()),
    })
  }, [solvencyQuery.data, solvencyQuery.dataUpdatedAt, positionsStorageKey])

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

  const sortedPositionRows = useMemo(() => {
    const rows = positionsQuery.data?.items ?? []
    const scored = rows.map((row) => ({
      row,
      ltvRatio: parseScaledNumber(row.ltv, 18),
      healthFactor: (() => {
        const ltvRatio = parseScaledNumber(row.ltv, 18)
        if (ltvRatio == null || positionLtRatio == null || positionLtRatio <= 0) return null
        return ltvRatio / positionLtRatio
      })(),
      debtValueNum: parseScaledNumber(row.debtValue, 18),
      collateralValueNum: parseScaledNumber(row.collateralValue, 18),
      isSolvent: (() => {
        const address = extractBorrowerAddress(row.accountId)
        if (!address) return null
        if (!solvencyQuery.data) return null
        return solvencyQuery.data.get(address) ?? null
      })(),
    }))
    scored.sort((a, b) => {
      const lhs: Record<PositionsSortColumn, number | null> = {
        healthFactor: a.healthFactor,
        ltv: a.ltvRatio,
        debtValue: a.debtValueNum,
        collateralValue: a.collateralValueNum,
      }
      const rhs: Record<PositionsSortColumn, number | null> = {
        healthFactor: b.healthFactor,
        ltv: b.ltvRatio,
        debtValue: b.debtValueNum,
        collateralValue: b.collateralValueNum,
      }
      const cmp = compareValues(lhs[positionsSortColumn], rhs[positionsSortColumn])
      return positionsSortDirection === 'asc' ? cmp : -cmp
    })
    return scored
  }, [positionsQuery.data?.items, positionsSortColumn, positionsSortDirection, solvencyQuery.data, positionLtRatio])

  const toggleSort = (column: SortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection('asc')
      return
    }
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const updateFilter = (key: keyof ColumnFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const sortIndicator = (column: SortColumn): string => {
    if (sortColumn !== column) return ''
    return sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  const positionsSortIndicator = (column: PositionsSortColumn): string => {
    if (positionsSortColumn !== column) return ''
    return positionsSortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  const togglePositionsSort = (column: PositionsSortColumn) => {
    if (positionsSortColumn !== column) {
      setPositionsSortColumn(column)
      setPositionsSortDirection('desc')
      return
    }
    setPositionsSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }

  const syncMarketCachesFromPositionsRefresh = async () => {
    if (!selectedRow || selectedChainId == null || !selectedSiloAddress) return
    const marketKey = `${selectedRow.chainId}:${selectedRow.siloAddress.toLowerCase()}`
    const allItems = await fetchAllOpenPositionsByMarket(selectedRow.chainId, selectedRow.siloAddress, graphPageLimit)
    const allBorrowerAddresses = Array.from(
      new Set(allItems.map((item) => extractBorrowerAddress(item.accountId)).filter(Boolean))
    ) as string[]
    const solvencyByBorrower =
      allBorrowerAddresses.length > 0
        ? await fetchBorrowersSolvency(selectedRow.chainId, selectedRow.siloAddress, allBorrowerAddresses)
        : new Map<string, boolean>()

    let warningCount = 0
    let insolventCount = 0
    for (const item of allItems) {
      const ltvRatio = parseScaledNumber(item.ltv, 18)
      const healthFactor = ltvRatio != null && positionLtRatio != null && positionLtRatio > 0 ? ltvRatio / positionLtRatio : null
      const borrowerAddress = extractBorrowerAddress(item.accountId)
      const isSolvent = borrowerAddress ? solvencyByBorrower.get(borrowerAddress) : undefined
      const isInsolvent = isSolvent === false || (healthFactor != null && healthFactor >= 1)
      const isWarning = !isInsolvent && healthFactor != null && healthFactor >= 0.95
      if (isInsolvent) insolventCount += 1
      else if (isWarning) warningCount += 1
    }

    queryClient.setQueryData<Map<string, number>>(
      ['liq', 'markets', 'counts', snapshotKey, config.testGraphLimit],
      (prev) => {
        const next = new Map(prev ?? [])
        next.set(marketKey, allItems.length)
        return next
      }
    )

    queryClient.setQueryData<Map<string, PrefetchedMarketPositionsEntry>>(
      ['liq', 'markets', 'positions-prefetch', snapshotKey, graphPageLimit],
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
      ['liq', 'positions', selectedChainId, selectedSiloAddress, pageLimit, paginationOffset],
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
    const next = new URLSearchParams(searchParams.toString())
    next.set('view', 'positions')
    next.set('chain', String(row.chainId))
    next.set('silo', row.siloAddress)
    next.delete('offset')
    void router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const backToMarkets = () => {
    const next = new URLSearchParams(searchParams.toString())
    next.delete('view')
    next.delete('chain')
    next.delete('silo')
    next.delete('offset')
    void router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false })
  }

  const jumpPage = (nextOffset: number) => {
    if (config.testDisablePagination) return
    const safe = Math.max(0, nextOffset)
    const next = new URLSearchParams(searchParams.toString())
    next.set('offset', String(safe))
    void router.replace(`${pathname}?${next.toString()}`, { scroll: false })
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
              <h2 className="text-xl font-semibold silo-text-main m-0">
                {selectedRow.marketTokenPair}
              </h2>
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
              <button
                type="button"
                className="text-xs ml-1 silo-text-soft hover:silo-text-main"
                aria-label="Copy market address"
                title="Copy market address"
                onClick={() => {
                  void copyToClipboard(selectedRow.siloAddress)
                }}
              >
                ⧉
              </button>
              <span className="ml-4">{selectedRow.marketTokenPair}</span>
              <span className="ml-4">LT {positionLtLabel}</span>
            </p>
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
                  {positionsTotalRecords} positions
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
                      <th className="text-left px-4 py-3 font-semibold">Borrower</th>
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => togglePositionsSort('ltv')}>
                          LTV{positionsSortIndicator('ltv')}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => togglePositionsSort('debtValue')}>
                          Debt Value{positionsSortIndicator('debtValue')}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => togglePositionsSort('collateralValue')}>
                          Collateral Value{positionsSortIndicator('collateralValue')}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold">
                        <button type="button" onClick={() => togglePositionsSort('healthFactor')}>
                          Health Factor{positionsSortIndicator('healthFactor')}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold">Solvent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPositionRows.map(({ row, healthFactor, isSolvent }) => {
                      const borrowerAddress = extractBorrowerAddress(row.accountId)
                      const isInsolventByRatio = healthFactor != null && healthFactor >= 1
                      const isInsolvent = isSolvent === false || isInsolventByRatio
                      const isNearLt = !isInsolvent && healthFactor != null && healthFactor >= 0.95
                      const hasLtMismatch =
                        isSolvent != null &&
                        healthFactor != null &&
                        ((isSolvent === false && healthFactor < 1) || (isSolvent === true && healthFactor >= 1))
                      const rowClassName = isInsolvent
                        ? 'border-t border-[var(--silo-border)] text-[color-mix(in_srgb,var(--silo-danger)_80%,#5b1322)]'
                        : isNearLt
                          ? 'border-t border-[var(--silo-border)] text-[color-mix(in_srgb,var(--silo-warning)_80%,#5a3b12)]'
                          : 'border-t border-[var(--silo-border)]'
                      const symbolToneClass = isInsolvent
                        ? 'text-[11px] text-[color-mix(in_srgb,var(--silo-danger)_62%,#5b1322)]'
                        : isNearLt
                          ? 'text-[11px] text-[color-mix(in_srgb,var(--silo-warning)_52%,#5a3b12)]'
                          : 'text-[11px] silo-text-soft'
                      return (
                        <Fragment key={row.id}>
                          <tr className={rowClassName}>
                            <td className="px-4 py-3 font-mono">
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
                                  <button
                                    type="button"
                                    className="text-xs silo-text-soft hover:silo-text-main"
                                    aria-label="Copy borrower address"
                                    title="Copy borrower address"
                                    onClick={() => {
                                      void copyToClipboard(borrowerAddress)
                                    }}
                                  >
                                    ⧉
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3">{formatPositionLtv(row.ltv)}</td>
                            <td className="px-4 py-3">
                              {formatScaledValue(row.debtValue, 18, 2)}
                              {row.debtValue ? (
                                <span className={`ml-1 ${symbolToneClass}`}>
                                  {selectedRow.quoteTokenSymbol ?? selectedRow.tokenSymbol ?? ''}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              {formatScaledValue(row.collateralValue, 18, 2)}
                              {row.collateralValue ? (
                                <span className={`ml-1 ${symbolToneClass}`}>
                                  {selectedRow.quoteTokenSymbol ?? selectedRow.tokenSymbol ?? ''}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">{formatHealthFactor(healthFactor)}</td>
                            <td className="px-4 py-3">
                              {isSolvent == null ? (
                                <span className="silo-text-soft">—</span>
                              ) : isSolvent ? (
                                <span className="text-[color-mix(in_srgb,var(--silo-success)_80%,#1e6a3a)]">yes</span>
                              ) : (
                                <span className="text-[color-mix(in_srgb,var(--silo-danger)_85%,#4f0f1c)] font-semibold">no</span>
                              )}
                            </td>
                          </tr>
                          {hasLtMismatch ? (
                            <tr className="border-t border-[var(--silo-border)]">
                              <td colSpan={6} className="px-4 py-2 text-xs text-[color-mix(in_srgb,var(--silo-warning)_88%,#5a3b12)]">
                                Warning: `isSolvent` and Health Factor threshold are divergent for this borrower (possible rounding or pricing mismatch).
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })}
                    {(positionsQuery.data?.items ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-4 text-sm silo-text-soft">
                          No open positions returned for this market.
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
                        Token symbol
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-10 gap-3 items-center">
                        <input
                          className="silo-input silo-input--sm min-w-[120px] w-full sm:col-span-3"
                          placeholder="e.g. WETH"
                          value={filters.token}
                          onChange={(e) => updateFilter('token', e.target.value)}
                        />
                        <label className="inline-flex items-center gap-2 text-xs silo-text-soft sm:col-span-7">
                          <input
                            type="checkbox"
                            checked={filters.hideZeroPositions}
                            onChange={(e) => setFilters((prev) => ({ ...prev, hideZeroPositions: e.target.checked }))}
                          />
                          <span>Hide markets without positions</span>
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
                              className={`silo-btn-secondary text-xs inline-flex items-center gap-2 ${
                                isSelected
                                  ? 'bg-[color-mix(in_srgb,var(--silo-soft-purple)_44%,var(--silo-surface))] border-[color-mix(in_srgb,var(--silo-accent)_45%,var(--silo-border))]'
                                  : 'bg-[var(--silo-surface)] border-[var(--silo-border)]'
                              }`}
                              aria-pressed={isSelected}
                              onClick={() =>
                                setSelectedChains((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(chainId)) next.delete(chainId)
                                  else next.add(chainId)
                                  return next
                                })
                              }
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
                          onClick={() => setSelectedChains(new Set())}
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
                        <button type="button" onClick={() => toggleSort('liquidity')}>
                          Liquidity{sortIndicator('liquidity')}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-semibold">
                        <button type="button" onClick={() => toggleSort('totalDebt')}>
                          Total Debt{sortIndicator('totalDebt')}
                        </button>
                      </th>
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
                        isDynamicLoading={
                          !isClientMounted || dynamicStateQuery.isLoading || dynamicStateQuery.isFetching
                        }
                        isCountsLoading={
                          !isClientMounted || positionsCountQuery.isLoading || positionsCountQuery.isFetching
                        }
                        isPrefetchLoading={
                          !isClientMounted ||
                          prefetchedMarketPositionsQuery.isLoading ||
                          prefetchedMarketPositionsQuery.isFetching
                        }
                        hasDynamicError={dynamicStateQuery.isError}
                        hasCountsError={positionsCountQuery.isError}
                        hasPrefetchError={prefetchedMarketPositionsQuery.isError}
                        onOpenPositions={() => openPositionsView(row)}
                      />
                    ))}
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-5 text-sm silo-text-soft">
                          {marketRows.length === 0 ? 'No markets available in snapshot.' : 'No markets match this filter.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
            </>
        </div>
      )}
    </div>
  )
}

function FragmentRow({
  row,
  onOpenPositions,
  isDynamicLoading,
  isCountsLoading,
  isPrefetchLoading,
  hasDynamicError,
  hasCountsError,
  hasPrefetchError,
}: {
  row: MarketRow
  onOpenPositions: () => void
  isDynamicLoading: boolean
  isCountsLoading: boolean
  isPrefetchLoading: boolean
  hasDynamicError: boolean
  hasCountsError: boolean
  hasPrefetchError: boolean
}) {
  const canOpenPositions = (row.positionsCount ?? 0) > 0
  const warningCount = row.warningPositionsCount ?? 0
  const insolventCount = row.insolventPositionsCount ?? 0

  return (
    <>
      <tr className="border-t border-[var(--silo-border)] hover:bg-[color-mix(in_srgb,var(--silo-soft-purple)_18%,var(--silo-surface))]">
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
          <a
            href={getExplorerAddressUrl(row.chainId, row.siloAddress)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-mono text-[var(--silo-text)] hover:underline break-all"
          >
            {shortenSiloAddress(row.siloAddress)}
          </a>
          <div className="text-xs mt-1">
            <span className="silo-text-soft">#{row.siloId ?? '—'}</span>
            <span className="silo-text-faint"> • {row.marketTokenPair}</span>
          </div>
        </td>
        <td className="px-4 py-3">{row.tokenSymbol ?? 'Unknown'}</td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.totalAssets == null
            ? isDynamicLoading || !hasDynamicError
              ? <InlineLoadingHint />
              : '—'
            : formatMetric(row.totalAssets, row.tokenDecimals)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.liquidity == null ? (isDynamicLoading || !hasDynamicError ? <InlineLoadingHint /> : '—') : formatMetric(row.liquidity, row.tokenDecimals)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.totalDebt == null ? (isDynamicLoading || !hasDynamicError ? <InlineLoadingHint /> : '—') : formatMetric(row.totalDebt, row.tokenDecimals)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {row.positionsCount == null ? (
            isCountsLoading || !hasCountsError ? <InlineLoadingHint /> : '—'
          ) : canOpenPositions ? (
            <button
              type="button"
              onClick={onOpenPositions}
              className="inline-flex items-center gap-2 font-semibold hover:underline"
              title="Open positions"
            >
              <span className="text-[var(--silo-text)]">{row.positionsCount}</span>
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
          ) : (
            <span className="inline-flex items-center gap-2">
              <span className="silo-text-soft">{row.positionsCount ?? '—'}</span>
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
            </span>
          )}
        </td>
      </tr>
      {row.needsSanityAlert ? (
        <tr className="border-t border-[var(--silo-border)] bg-[color-mix(in_srgb,var(--silo-danger)_10%,var(--silo-surface))]">
          <td colSpan={7} className="px-4 py-2 text-xs text-[color-mix(in_srgb,var(--silo-danger)_75%,var(--silo-text))]">
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
