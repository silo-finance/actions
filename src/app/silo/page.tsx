'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import ConnectWalletModal from '@/components/ConnectWalletModal'
import CopyButton from '@/components/CopyButton'
import SiloDeploymentsList from '@/components/SiloDeploymentsList'
import SiloOracleChangeSection from '@/components/SiloOracleChangeSection'
import SiloOracleChangeBothSilosSection from '@/components/SiloOracleChangeBothSilosSection'
import { useWeb3 } from '@/contexts/Web3Context'
import { getRevertingOracleAddress } from '@/config/revertingOracleDeployments'
import { extractHexAddressLike } from '@/utils/addressFromInput'
import { normalizeAddress } from '@/utils/addressValidation'
import { classifyVaultInput } from '@/utils/explorerInput'
import {
  readManageableOracleState,
  readSiloConfigEntries,
  type ManageableOracleState,
  type SiloConfigEntry,
} from '@/utils/manageableOracleReader'
import { getExplorerAddressUrl, getNetworkDisplayName, getNetworkIconPath, isChainSupported } from '@/utils/networks'
import { analyzeOwnerKind, type OwnerKind } from '@/utils/ownerKind'
import { resolveSiloInput, type ResolvedSiloInput } from '@/utils/resolveSiloInput'
import { toUserErrorMessage } from '@/utils/rpcErrors'

type OracleStateEntry = {
  loading: boolean
  state: ManageableOracleState | null
  ownerKind: OwnerKind | null
  error: string | null
}

function parseChainFromSearchParam(raw: string | null): number | null {
  if (raw == null || !raw.trim()) return null
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return isChainSupported(n) ? n : null
}

function siloLabel(index: number): string {
  return `Silo${index}`
}

/** `0xabc123…ef01` — same shape we use in other market cards (MarketItem, VaultSummaryPanel). */
function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function SiloPageInner() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { provider, chainId, isConnected, switchNetwork, account, eip1193Provider } = useWeb3()
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const closeConnectModal = useCallback(() => setConnectModalOpen(false), [])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [resolved, setResolved] = useState<ResolvedSiloInput | null>(null)
  const [resolvedChainId, setResolvedChainId] = useState<number | null>(null)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null)
  const [siloEntries, setSiloEntries] = useState<SiloConfigEntry[] | null>(null)
  const [siloEntriesLoading, setSiloEntriesLoading] = useState(false)
  const [siloEntriesError, setSiloEntriesError] = useState<string | null>(null)
  /**
   * Symbol overrides supplied by the predefined-silos picker (already has both asset symbols from
   * the Silo v3 GraphQL response). Keyed by lowercased SiloConfig address so stale entries never
   * leak into unrelated markets; the reader uses them to skip on-chain `ERC20.symbol()` calls.
   */
  const [predefinedSymbols, setPredefinedSymbols] = useState<
    Record<string, Record<string, string>>
  >({})

  /** Set to `true` only after the user clicks the "Set Reverting Oracle" action button. */
  const [actionOpen, setActionOpen] = useState(false)
  /** Lower-cased silo addresses the user has ticked in the picker — checkbox semantics, no default. */
  const [checkedSilos, setCheckedSilos] = useState<Set<string>>(new Set())
  /** Lazy per-silo oracle state keyed by the silo address (lowercase). Populated on checkbox tick. */
  const [oracleStates, setOracleStates] = useState<Record<string, OracleStateEntry>>({})
  /**
   * Mirror of `oracleStates` that the lazy-load effect reads *without* subscribing to it. Keeping
   * `oracleStates` in that effect's deps caused a self-cancelling loop: the effect set
   * `loading: true` → deps changed → cleanup fired `cancelled = true` → re-run found nothing to
   * load → the original async returned early and never wrote the result, so the UI stayed stuck
   * on "Loading solvency oracle…". Updating the ref synchronously during render keeps it current
   * when effects run, without creating that loop.
   */
  const oracleStatesRef = useRef(oracleStates)
  oracleStatesRef.current = oracleStates
  const [refreshTick, setRefreshTick] = useState(0)

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const initialQueryParams = useMemo(
    () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    []
  )
  const chainFromUrl = useMemo(
    () => parseChainFromSearchParam(initialQueryParams.get('chain')),
    [initialQueryParams]
  )
  const addressFromUrl = useMemo(() => {
    const raw = initialQueryParams.get('address')
    if (!raw?.trim()) return null
    return normalizeAddress(extractHexAddressLike(raw.trim()))
  }, [initialQueryParams])
  const deepLinkKey = useMemo(
    () => `${addressFromUrl?.toLowerCase() ?? ''}|${chainFromUrl ?? ''}`,
    [addressFromUrl, chainFromUrl]
  )
  const initialDeepLinkRef = useRef(deepLinkKey)
  const isInitialDeepLink = deepLinkKey === initialDeepLinkRef.current
  const [deepLinkChainApplied, setDeepLinkChainApplied] = useState(() => chainFromUrl == null)
  const deepLinkAutoRanKeyRef = useRef<string | null>(null)
  const deepLinkSwitchStartedRef = useRef(false)

  const displayChainId = resolvedChainId ?? chainId

  const resolvedShareUrl = useMemo(() => {
    if (!resolvedAddress || resolvedChainId == null || typeof window === 'undefined') return ''
    const q = new URLSearchParams()
    q.set('address', resolvedAddress)
    q.set('chain', String(resolvedChainId))
    return `${window.location.origin}${basePath}/silo/?${q.toString()}`
  }, [resolvedAddress, resolvedChainId, basePath])

  const networkName = displayChainId != null ? getNetworkDisplayName(displayChainId) : null
  const networkIconPath = displayChainId != null ? getNetworkIconPath(displayChainId) : null
  const networkIconSrc = networkIconPath ? `${basePath}${networkIconPath}` : null

  const resetResolvedState = useCallback(() => {
    setResolved(null)
    setResolvedChainId(null)
    setResolvedAddress(null)
    setSiloEntries(null)
    setSiloEntriesLoading(false)
    setSiloEntriesError(null)
    setActionOpen(false)
    setCheckedSilos(new Set())
    setOracleStates({})
  }, [])

  useEffect(() => {
    if (addressFromUrl) setInput(addressFromUrl)
  }, [addressFromUrl])

  /**
   * Client-side navigation to `/silo` (e.g. clicking "Silo" in the header while already on the
   * page) keeps this component mounted, so state would otherwise survive. Whenever the URL query
   * string is empty — no `address` and no `chain` — clear input + all resolved state so the page
   * behaves like a fresh load. Deps are *only* `searchParams` + `resetResolvedState`: reacting to
   * state changes too (input/resolved/loading/error) was trampling `performCheck`'s in-flight
   * updates whenever the user clicked a predefined-silo button from the base URL, because the
   * effect fired mid-await and clobbered `input`/`resolved` before the URL had a chance to update.
   */
  useEffect(() => {
    const hasAddress = !!searchParams.get('address')
    const hasChain = !!searchParams.get('chain')
    if (hasAddress || hasChain) return
    setInput('')
    setError('')
    setLoading(false)
    resetResolvedState()
  }, [searchParams, resetResolvedState])

  /** Apply deep-link `chain` param once after connect. */
  useEffect(() => {
    if (!isInitialDeepLink) return
    if (!isConnected || chainId == null) return
    if (deepLinkChainApplied) return
    if (chainFromUrl == null || !isChainSupported(chainFromUrl)) {
      setDeepLinkChainApplied(true)
      return
    }
    if (chainId === chainFromUrl) {
      setDeepLinkChainApplied(true)
      return
    }
    if (deepLinkSwitchStartedRef.current) return
    deepLinkSwitchStartedRef.current = true
    void switchNetwork(chainFromUrl).finally(() => setDeepLinkChainApplied(true))
  }, [isInitialDeepLink, isConnected, chainId, chainFromUrl, deepLinkChainApplied, switchNetwork])

  const performCheck = useCallback(
    async (rawInput: string) => {
      setError('')
      resetResolvedState()

      if (!isConnected || !provider || chainId == null) {
        setError('Connect a wallet to load Silo data.')
        return
      }

      const classified = classifyVaultInput(rawInput)

      if (classified.kind === 'unknown_url') {
        setError(
          'This URL is not a known block explorer for a supported chain. Use a link from one of those explorers or paste a plain address on your current network.'
        )
        return
      }

      if (classified.kind === 'explorer') {
        if (!isChainSupported(classified.chainId)) {
          setError('The explorer in this URL points to a chain that is not supported here.')
          return
        }
        if (classified.chainId !== chainId) {
          await switchNetwork(classified.chainId)
        }
      } else if (!isChainSupported(chainId)) {
        setError('This network is not in the supported list. Switch network in the header.')
        return
      }

      const hex = extractHexAddressLike(rawInput)
      const target = normalizeAddress(hex)
      if (!target) {
        setError('Enter a valid address or a block explorer URL containing the contract address.')
        return
      }

      const net = await provider.getNetwork()
      const effectiveChainId = Number(net.chainId)
      if (!isChainSupported(effectiveChainId)) {
        setError('This network is not in the supported list. Switch network in the header.')
        return
      }
      if (classified.kind === 'explorer' && effectiveChainId !== classified.chainId) {
        setError('Switch to the network from the explorer URL in your wallet, then press Check again.')
        return
      }

      setLoading(true)
      try {
        const result = await resolveSiloInput(provider, target)
        setResolved(result)
        setResolvedChainId(effectiveChainId)
        setResolvedAddress(target)

        /** Canonicalize URL (?address=&chain=) on successful resolve. */
        if (pathname && typeof window !== 'undefined') {
          const p = new URLSearchParams(window.location.search)
          const already =
            p.get('address')?.toLowerCase() === target.toLowerCase() &&
            p.get('chain') === String(effectiveChainId)
          if (!already) {
            p.set('address', target)
            p.set('chain', String(effectiveChainId))
            const qs = p.toString()
            void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
          }
        }
      } catch (e) {
        setError(toUserErrorMessage(e, 'Failed to read the input. Check address and network.'))
      } finally {
        setLoading(false)
      }
    },
    [isConnected, provider, chainId, switchNetwork, pathname, router, resetResolvedState]
  )

  const handleCheck = useCallback(() => {
    void performCheck(input)
  }, [performCheck, input])

  /**
   * Predefined silo selector: clicking a button fills the input and runs the same `performCheck`
   * flow as pressing Enter, so the resolved address + `?address=&chain=` URL update naturally.
   */
  const handlePredefinedSiloSelect = useCallback(
    (siloConfig: string, symbolOverrides: Record<string, string>) => {
      setInput(siloConfig)
      setPredefinedSymbols((prev) => ({
        ...prev,
        [siloConfig.toLowerCase()]: symbolOverrides,
      }))
      void performCheck(siloConfig)
    },
    [performCheck]
  )

  /** Auto-run the initial deep-link check once the wallet is connected on the right chain. */
  useEffect(() => {
    if (!isInitialDeepLink) return
    if (!deepLinkChainApplied) return
    if (loading || resolved) return
    if (!isConnected || !provider || chainId == null) return
    if (!addressFromUrl || chainFromUrl == null || !isChainSupported(chainFromUrl)) return
    if (chainId !== chainFromUrl) return

    const key = `${deepLinkKey}|${(account ?? '').toLowerCase()}`
    if (deepLinkAutoRanKeyRef.current === key) return
    deepLinkAutoRanKeyRef.current = key
    void performCheck(addressFromUrl)
  }, [
    isInitialDeepLink,
    deepLinkChainApplied,
    loading,
    resolved,
    isConnected,
    provider,
    chainId,
    addressFromUrl,
    chainFromUrl,
    deepLinkKey,
    account,
    performCheck,
  ])

  /**
   * Row 2 complete → fetch full `SiloConfig.getConfig(silo)` + ERC20 `symbol()` for each silo in a
   * single pair of multicalls. This gives the UI silo IDs + asset symbols up front without having
   * to read the solvency oracle yet — we keep that lazy until the user ticks a checkbox.
   */
  useEffect(() => {
    if (!resolved || !provider || resolvedChainId == null) {
      setSiloEntries(null)
      setSiloEntriesLoading(false)
      setSiloEntriesError(null)
      return
    }
    let cancelled = false
    setSiloEntriesLoading(true)
    setSiloEntriesError(null)
    void (async () => {
      try {
        const overrides = predefinedSymbols[resolved.siloConfig.toLowerCase()]
        const entries = await readSiloConfigEntries(
          provider,
          resolved.siloConfig,
          resolved.silos,
          overrides
        )
        if (!cancelled) setSiloEntries(entries)
      } catch (e) {
        if (!cancelled) {
          setSiloEntries(null)
          setSiloEntriesError(toUserErrorMessage(e, 'Failed to read silo configuration.'))
        }
      } finally {
        if (!cancelled) setSiloEntriesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolved, provider, resolvedChainId, refreshTick, predefinedSymbols])

  /**
   * Drop cached symbol overrides on chain change so a stale entry from chain A never bleeds into a
   * SiloConfig on chain B that happens to share the same address (extremely unlikely, but trivial
   * to be strict about). Only the picker repopulates them, so typed inputs remain unaffected.
   */
  useEffect(() => {
    setPredefinedSymbols({})
  }, [chainId])

  /**
   * Lazy per-silo oracle state: whenever `checkedSilos` grows (or after a refresh) load the
   * ManageableOracle state + owner kind for each ticked silo. Unticking does not clear the cache —
   * re-ticking returns the cached state instantly while a refresh still reloads everything.
   */
  useEffect(() => {
    if (!provider || !siloEntries || checkedSilos.size === 0) return
    const currentStates = oracleStatesRef.current
    const entriesToLoad = siloEntries.filter((entry) => {
      const key = entry.silo.toLowerCase()
      if (!checkedSilos.has(key)) return false
      const current = currentStates[key]
      /** Refresh when there is no entry yet, or when the silo is no longer loading and no state. */
      return !current || (!current.loading && !current.state && !current.error)
    })
    if (entriesToLoad.length === 0) return
    let cancelled = false
    setOracleStates((prev) => {
      const next = { ...prev }
      for (const entry of entriesToLoad) {
        next[entry.silo.toLowerCase()] = { loading: true, state: null, ownerKind: null, error: null }
      }
      return next
    })
    void (async () => {
      await Promise.all(
        entriesToLoad.map(async (entry) => {
          const key = entry.silo.toLowerCase()
          try {
            if (
              !entry.solvencyOracle ||
              entry.solvencyOracle === '0x0000000000000000000000000000000000000000'
            ) {
              if (cancelled) return
              /**
               * The silo has no solvency oracle configured. We still need a non-null `state` so the
               * child component's "no solvency oracle configured" branch renders — passing `null`
               * used to leave the UI stuck on "Loading solvency oracle…" because `!oracleState`
               * is the same check that covers the in-flight case.
               */
              const emptyState: ManageableOracleState = {
                oracleAddress: '0x0000000000000000000000000000000000000000',
                versionString: null,
                contractName: null,
                version: null,
                isManageable: false,
                currentOracle: null,
                pendingOracle: null,
                owner: null,
              }
              setOracleStates((prev) => ({
                ...prev,
                [key]: { loading: false, state: emptyState, ownerKind: null, error: null },
              }))
              return
            }
            const state = await readManageableOracleState(provider, entry.solvencyOracle)
            let ownerKind: OwnerKind | null = null
            if (state.isManageable && state.owner) {
              ownerKind = await analyzeOwnerKind(provider, state.owner)
            }
            if (cancelled) return
            setOracleStates((prev) => ({
              ...prev,
              [key]: { loading: false, state, ownerKind, error: null },
            }))
          } catch (e) {
            if (cancelled) return
            setOracleStates((prev) => ({
              ...prev,
              [key]: {
                loading: false,
                state: null,
                ownerKind: null,
                error: toUserErrorMessage(e, 'Failed to read the solvency oracle state.'),
              },
            }))
          }
        })
      )
    })()
    return () => {
      cancelled = true
    }
  }, [provider, siloEntries, checkedSilos, refreshTick])

  /** Bumped by child components after a successful write so reads re-run and reveal the new state. */
  const triggerRefresh = useCallback(() => {
    setOracleStates({})
    setRefreshTick((n) => n + 1)
  }, [])

  const toggleSilo = useCallback((siloAddress: string) => {
    const key = siloAddress.toLowerCase()
    setCheckedSilos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const revertingOracleAddress = resolvedChainId != null ? getRevertingOracleAddress(resolvedChainId) : null

  /** SiloOracleChangeBothSilosSection only when BOTH silos of a SiloConfig are ticked and loaded. */
  const bothSilosLoadedEntries = useMemo(() => {
    if (!resolved) return null
    if (!siloEntries || siloEntries.length !== 2) return null
    const loaded = siloEntries.map((entry) => {
      const st = oracleStates[entry.silo.toLowerCase()]
      return {
        silo: entry.silo,
        solvencyOracle: entry.solvencyOracle,
        oracleState: st?.state ?? null,
        ownerKind: st?.ownerKind ?? null,
      }
    })
    const bothChecked = siloEntries.every((entry) => checkedSilos.has(entry.silo.toLowerCase()))
    if (!bothChecked) return null
    if (loaded.some((row) => row.oracleState == null)) return null
    return loaded
  }, [resolved, siloEntries, oracleStates, checkedSilos])

  return (
    <div className="silo-page px-4 py-8 sm:px-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
          ← Home
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-3xl font-bold silo-text-main m-0 leading-none">Silo</h1>
          {resolvedShareUrl ? (
            <ShareLinkCopyButton
              url={resolvedShareUrl}
              className="self-center shrink-0 -mt-0.5"
              iconClassName="w-4 h-4"
            />
          ) : null}
          {networkName ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-1.5">
              {networkIconSrc ? (
                <Image src={networkIconSrc} alt={networkName} width={16} height={16} className="rounded-full" />
              ) : null}
              <span className="text-sm font-semibold silo-text-main">{networkName}</span>
            </div>
          ) : null}
        </div>
      </div>

      {!isConnected && (
        <div className="silo-panel-soft p-4 mb-6 flex flex-wrap items-center gap-3">
          <p className="text-sm silo-text-main m-0">
            Connect a wallet (browser extension or WalletConnect) to read on-chain data.
          </p>
          <button
            type="button"
            onClick={() => setConnectModalOpen(true)}
            className="header-connect-button font-semibold py-2.5 px-4 rounded-full text-sm"
          >
            Connect wallet
          </button>
          <ConnectWalletModal open={connectModalOpen} onClose={closeConnectModal} />
        </div>
      )}

      {/* Row 0 — Predefined silos on the currently connected chain. */}
      {isConnected && chainId != null ? (
        <SiloDeploymentsList
          chainId={chainId}
          onSelect={handlePredefinedSiloSelect}
          disabled={loading}
        />
      ) : null}

      {/* Row 1 — Input (always visible) */}
      <div className="silo-panel silo-top-card p-6 mb-6">
        <label htmlFor="silo-input" className="block text-sm font-medium silo-text-main mb-2">
          Enter a Silo or SiloConfig address, or a block explorer URL
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="silo-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (loading) return
              void handleCheck()
            }}
            placeholder="0x… or supported explorer link to Silo / SiloConfig"
            className="flex-1 min-w-0 silo-input silo-input--md font-mono focus:outline-none focus:ring-0"
          />
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={loading || !isConnected}
            className="silo-btn-primary shrink-0 self-stretch sm:self-auto"
          >
            {loading ? 'Loading…' : 'Check'}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm silo-alert silo-alert-error">{error}</p> : null}

        {/* Inline silo summary (Silo / Silo0 / Silo1) shown right under the input as validation. */}
        {resolved && displayChainId != null ? (
          <div className="mt-4">
            {siloEntriesError ? (
              <p className="text-sm silo-alert silo-alert-error m-0">{siloEntriesError}</p>
            ) : siloEntriesLoading && !siloEntries ? (
              <p className="text-sm silo-text-soft m-0">Loading silo configuration…</p>
            ) : siloEntries ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  {siloEntries[0]?.siloId != null ? (
                    <span className="text-sm font-bold silo-text-main shrink-0">
                      #{siloEntries[0].siloId}
                    </span>
                  ) : null}
                  {siloEntries.map((entry, idx) => (
                    <SiloSummaryRow
                      key={entry.silo}
                      chainId={displayChainId}
                      label={siloLabel(idx)}
                      siloAddress={entry.silo}
                      symbol={entry.symbol}
                    />
                  ))}
                </div>
                {revertingOracleAddress == null && resolvedChainId != null ? (
                  <p className="text-xs silo-alert silo-alert-warning m-0">
                    RevertingOracle is not deployed on{' '}
                    {getNetworkDisplayName(resolvedChainId) ?? `chain ${resolvedChainId}`}. Submitting is disabled.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Row 3 — Action buttons. Only "Set Reverting Oracle" for now. */}
      {resolved && siloEntries && siloEntries.length > 0 ? (
        <div className="silo-panel p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-2">Actions</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="silo-btn-primary"
              data-selected={actionOpen ? 'true' : 'false'}
              disabled={actionOpen}
              onClick={() => setActionOpen(true)}
            >
              Set Reverting Oracle
            </button>
          </div>
        </div>
      ) : null}

      {/* Row 4 — Silo checkboxes (appear after clicking the action). */}
      {actionOpen && resolved && siloEntries ? (
        <div className="silo-panel p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-2">
            Which silo(s) should we update?
          </p>
          <div className="flex flex-wrap gap-2">
            {siloEntries.map((entry, idx) => {
              const key = entry.silo.toLowerCase()
              const checked = checkedSilos.has(key)
              const symbolText = entry.symbol ? ` · ${entry.symbol}` : ''
              return (
                <label
                  key={entry.silo}
                  className="flex flex-1 min-w-[16rem] items-center gap-3 cursor-pointer rounded-md border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-2 hover:border-[var(--silo-border-strong,var(--silo-border))]"
                  data-selected={checked ? 'true' : 'false'}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--silo-accent,currentColor)]"
                    checked={checked}
                    onChange={() => toggleSilo(entry.silo)}
                  />
                  <span className="text-sm font-semibold silo-text-main">
                    {siloLabel(idx)}
                    {symbolText}
                  </span>
                  <span className="text-xs font-mono silo-text-soft" title={entry.silo}>
                    {shortAddress(entry.silo)}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Row 5+ — One per-silo section for each ticked silo, plus the aggregate "both" row.
          When two silos are ticked the per-silo sections lay out side-by-side on md+ screens
          (Silo0 left, Silo1 right). Single-silo mode keeps the original full-width behaviour.
          We carry the *original* index into the child so `Silo0` / `Silo1` labels stay correct
          even if the user ticks them out of order. */}
      {actionOpen && resolved && siloEntries && displayChainId != null
        ? (() => {
            const tickedEntries = siloEntries
              .map((entry, idx) => ({ entry, idx }))
              .filter(({ entry }) => checkedSilos.has(entry.silo.toLowerCase()))
            const sideBySide = tickedEntries.length >= 2
            return (
              <div className="space-y-6">
                <div
                  className={`grid gap-6 grid-cols-1 ${sideBySide ? 'md:grid-cols-2' : ''}`}
                >
                  {tickedEntries.map(({ entry, idx }) => {
                    const key = entry.silo.toLowerCase()
                    const st = oracleStates[key]
                    return (
                      <SiloOracleChangeSection
                        key={entry.silo}
                        chainId={displayChainId}
                        siloIndex={idx}
                        siloSymbol={entry.symbol}
                        oracleState={st?.state ?? null}
                        ownerKind={st?.ownerKind ?? null}
                        loading={st?.loading ?? true}
                        errorMessage={st?.error ?? null}
                        provider={provider}
                        eip1193Provider={eip1193Provider}
                        connectedAccount={account}
                        revertingOracleAddress={revertingOracleAddress}
                        onActionSuccess={triggerRefresh}
                      />
                    )
                  })}
                </div>

                {bothSilosLoadedEntries ? (
                  <SiloOracleChangeBothSilosSection
                    chainId={displayChainId}
                    silos={bothSilosLoadedEntries}
                    provider={provider}
                    eip1193Provider={eip1193Provider}
                    connectedAccount={account}
                    revertingOracleAddress={revertingOracleAddress}
                    onActionSuccess={triggerRefresh}
                  />
                ) : null}
              </div>
            )
          })()
        : null}
    </div>
  )
}

function SiloSummaryRow({
  chainId,
  label,
  siloAddress,
  symbol,
}: {
  chainId: number
  label: string
  siloAddress: string
  symbol: string | null
}) {
  const url = getExplorerAddressUrl(chainId, siloAddress)
  return (
    <div className="flex items-center flex-nowrap gap-x-3 whitespace-nowrap">
      <span className="text-sm font-semibold silo-text-main shrink-0">{label}</span>
      {symbol ? (
        <span className="inline-flex items-center rounded-full border border-[var(--silo-border)] bg-[var(--silo-surface)] px-2 py-0.5 text-xs font-semibold silo-text-main shrink-0">
          {symbol}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-sm silo-text-main hover:underline"
          title={siloAddress}
        >
          {shortAddress(siloAddress)}
        </a>
        <CopyButton value={siloAddress} />
      </span>
    </div>
  )
}

export default function SiloPage() {
  return (
    <Suspense
      fallback={
        <div className="silo-page px-4 py-8 sm:px-6 max-w-4xl mx-auto">
          <p className="text-sm silo-text-soft m-0">Loading…</p>
        </div>
      }
    >
      <SiloPageInner />
    </Suspense>
  )
}
