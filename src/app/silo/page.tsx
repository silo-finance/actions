'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import ConnectWalletModal from '@/components/ConnectWalletModal'
import SiloOracleChangeSection from '@/components/SiloOracleChangeSection'
import SiloOracleChangeBothSilosSection from '@/components/SiloOracleChangeBothSilosSection'
import { useWeb3 } from '@/contexts/Web3Context'
import { getRevertingOracleAddress } from '@/config/revertingOracleDeployments'
import { extractHexAddressLike } from '@/utils/addressFromInput'
import { normalizeAddress } from '@/utils/addressValidation'
import { classifyVaultInput } from '@/utils/explorerInput'
import {
  readManageableOracleState,
  readSolvencyOraclesForSilos,
  type ManageableOracleState,
  type SiloSolvencyOracle,
} from '@/utils/manageableOracleReader'
import { getNetworkDisplayName, getNetworkIconPath, isChainSupported } from '@/utils/networks'
import { analyzeOwnerKind, type OwnerKind } from '@/utils/ownerKind'
import { resolveSiloInput, type ResolvedSiloInput } from '@/utils/resolveSiloInput'
import { toUserErrorMessage } from '@/utils/rpcErrors'

type SiloPicker = 'silo0' | 'silo1' | 'both'

type LoadedSiloOracle = SiloSolvencyOracle & {
  oracleState: ManageableOracleState | null
  ownerKind: OwnerKind | null
}

function parseChainFromSearchParam(raw: string | null): number | null {
  if (raw == null || !raw.trim()) return null
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return isChainSupported(n) ? n : null
}

function SiloPageInner() {
  const pathname = usePathname()
  const router = useRouter()
  const { provider, chainId, isConnected, switchNetwork, account, eip1193Provider } = useWeb3()
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const closeConnectModal = useCallback(() => setConnectModalOpen(false), [])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [resolved, setResolved] = useState<ResolvedSiloInput | null>(null)
  /** Chain on which `resolved` was read (used for display + deep-link). */
  const [resolvedChainId, setResolvedChainId] = useState<number | null>(null)
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null)
  const [siloOracles, setSiloOracles] = useState<SiloSolvencyOracle[] | null>(null)
  const [siloOracleStates, setSiloOracleStates] = useState<LoadedSiloOracle[] | null>(null)
  const [oracleStatesLoading, setOracleStatesLoading] = useState(false)
  const [selection, setSelection] = useState<SiloPicker>('silo0')
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
    setSiloOracles(null)
    setSiloOracleStates(null)
    setOracleStatesLoading(false)
    setSelection('silo0')
  }, [])

  useEffect(() => {
    if (addressFromUrl) setInput(addressFromUrl)
  }, [addressFromUrl])

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
        /** Default silo picker to silo0 for SiloConfig (single-silo kind never reads `selection`). */
        setSelection('silo0')

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

  /** Step 2 complete → fetch solvency oracles for all silos in the resolved package. */
  useEffect(() => {
    if (!resolved || !provider || resolvedChainId == null) {
      setSiloOracles(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const results = await readSolvencyOraclesForSilos(provider, resolved.siloConfig, resolved.silos)
        if (!cancelled) setSiloOracles(results)
      } catch (e) {
        if (!cancelled) setError(toUserErrorMessage(e, 'Failed to read silo configuration.'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolved, provider, resolvedChainId, refreshTick])

  /** Step 3 complete → read each solvency oracle's state in parallel. */
  useEffect(() => {
    if (!siloOracles || !provider) {
      setSiloOracleStates(null)
      setOracleStatesLoading(false)
      return
    }
    let cancelled = false
    setOracleStatesLoading(true)
    void (async () => {
      try {
        const loaded: LoadedSiloOracle[] = await Promise.all(
          siloOracles.map(async (entry) => {
            if (!entry.solvencyOracle || entry.solvencyOracle === '0x0000000000000000000000000000000000000000') {
              return { ...entry, oracleState: null, ownerKind: null }
            }
            const state = await readManageableOracleState(provider, entry.solvencyOracle)
            let ownerKind: OwnerKind | null = null
            if (state.isManageable && state.owner) {
              ownerKind = await analyzeOwnerKind(provider, state.owner)
            }
            return { ...entry, oracleState: state, ownerKind }
          })
        )
        if (!cancelled) setSiloOracleStates(loaded)
      } catch (e) {
        if (!cancelled) setError(toUserErrorMessage(e, 'Failed to read the solvency oracle state.'))
      } finally {
        if (!cancelled) setOracleStatesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [siloOracles, provider])

  const selectedEntries = useMemo(() => {
    if (!siloOracleStates) return []
    if (!resolved) return []
    if (resolved.kind === 'silo') return siloOracleStates
    if (selection === 'silo0') return siloOracleStates.slice(0, 1)
    if (selection === 'silo1') return siloOracleStates.slice(1, 2)
    return siloOracleStates
  }, [siloOracleStates, selection, resolved])

  const revertingOracleAddress = resolvedChainId != null ? getRevertingOracleAddress(resolvedChainId) : null
  const triggerRefresh = useCallback(() => setRefreshTick((n) => n + 1), [])

  /**
   * Row 7b: aggregate "Submit for both silos" appears only when the user actually picked both
   * silos in a SiloConfig AND every precondition is satisfied. The Both-section itself validates
   * shared-owner + no-pending + ManageableOracle; the page only gates visibility on selection.
   */
  const showBothSection =
    resolved?.kind === 'silo_config' &&
    selection === 'both' &&
    siloOracleStates != null &&
    siloOracleStates.length === 2

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
      </div>

      {/* Row 2 — Detected kind + resolved addresses */}
      {resolved ? (
        <div className="silo-panel p-5 mb-6 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">Detected</p>
            <p className="text-sm silo-text-main m-0">
              {resolved.kind === 'silo' ? 'Silo contract' : 'SiloConfig contract'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">SiloConfig</p>
            <p className="text-sm font-mono silo-text-main m-0 break-all">{resolved.siloConfig}</p>
          </div>
          {resolved.kind === 'silo_config' ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">silo0</p>
                <p className="text-sm font-mono silo-text-main m-0 break-all">{resolved.silos[0]}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">silo1</p>
                <p className="text-sm font-mono silo-text-main m-0 break-all">{resolved.silos[1]}</p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">Silo</p>
              <p className="text-sm font-mono silo-text-main m-0 break-all">{resolved.silos[0]}</p>
            </div>
          )}
          {revertingOracleAddress == null && resolvedChainId != null ? (
            <p className="text-xs silo-alert silo-alert-warning m-0">
              RevertingOracle is not deployed on {getNetworkDisplayName(resolvedChainId) ?? `chain ${resolvedChainId}`}. Submitting is disabled.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Row 3 — Silo picker (SiloConfig only) */}
      {resolved?.kind === 'silo_config' && siloOracles ? (
        <div className="silo-panel p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-2">
            Which silo(s) should we update?
          </p>
          <div className="flex flex-wrap gap-2">
            {(['silo0', 'silo1', 'both'] as SiloPicker[]).map((opt) => (
              <button
                key={opt}
                type="button"
                className="silo-choice-option text-sm"
                data-selected={selection === opt ? 'true' : 'false'}
                onClick={() => setSelection(opt)}
              >
                <span className="block min-w-0 flex-1">
                  <span className="block text-sm font-semibold silo-text-main">
                    {opt === 'both' ? 'Both silos' : opt === 'silo0' ? 'silo0' : 'silo1'}
                  </span>
                  {opt !== 'both' ? (
                    <span className="block text-xs font-mono silo-text-soft mt-0.5 break-all">
                      {opt === 'silo0' ? siloOracles[0]?.silo : siloOracles[1]?.silo}
                    </span>
                  ) : (
                    <span className="block text-xs silo-text-soft mt-0.5">
                      Propose on both solvency oracles
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Rows 4–7 — one SiloOracleChangeSection per selected silo */}
      {resolved && displayChainId != null ? (
        <div className="space-y-6">
          {oracleStatesLoading && !siloOracleStates ? (
            <p className="text-sm silo-text-soft m-0">Loading solvency oracle state…</p>
          ) : null}
          {selectedEntries.map((entry, idx) => (
            <SiloOracleChangeSection
              key={`${entry.silo}-${idx}`}
              chainId={displayChainId}
              siloIndex={
                resolved.kind === 'silo' ? null : siloOracleStates?.[0]?.silo === entry.silo ? 0 : 1
              }
              siloAddress={entry.silo}
              siloConfig={resolved.siloConfig}
              oracleState={entry.oracleState}
              ownerKind={entry.ownerKind}
              provider={provider}
              eip1193Provider={eip1193Provider}
              connectedAccount={account}
              revertingOracleAddress={revertingOracleAddress}
              onActionSuccess={triggerRefresh}
            />
          ))}

          {showBothSection ? (
            <SiloOracleChangeBothSilosSection
              chainId={displayChainId}
              silos={siloOracleStates!}
              provider={provider}
              eip1193Provider={eip1193Provider}
              connectedAccount={account}
              revertingOracleAddress={revertingOracleAddress}
              onActionSuccess={triggerRefresh}
            />
          ) : null}
        </div>
      ) : null}
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
