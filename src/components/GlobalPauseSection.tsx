'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { getAddress } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import { useWeb3 } from '@/contexts/Web3Context'
import {
  filterAddressesWithoutOverride,
  getGlobalPauseContractNameOverride,
} from '@/config/globalPauseContractNameOverrides'
import { fetchGlobalPauseContractNames } from '@/utils/globalPauseContractNames'
import { fetchGlobalPauseAddress, type GlobalPauseDeployment } from '@/utils/globalPauseDeployment'
import { fetchGlobalPauseOverview, type GlobalPauseOverview } from '@/utils/globalPauseReader'
import {
  getExplorerAddressUrl,
  getNetworkDisplayName,
  getNetworkIconPath,
  isChainSupported,
} from '@/utils/networks'
import { pauseAllGlobal, unpauseAllGlobal, type GlobalPauseWriteSuccess } from '@/utils/pauseAllGlobal'
import { toUserErrorMessage } from '@/utils/rpcErrors'

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function normalizeOrNull(addr: string): string | null {
  try {
    return getAddress(addr)
  } catch {
    return null
  }
}

type AddressLinkProps = {
  chainId: number
  address: string
  mono?: boolean
}

function AddressLink({ chainId, address, mono = true }: AddressLinkProps) {
  const url = getExplorerAddressUrl(chainId, address)
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${mono ? 'font-mono' : ''} text-sm silo-text-main hover:underline truncate`}
        title={address}
      >
        {shortAddr(address)}
      </a>
      <CopyButton value={address} />
    </span>
  )
}

type StatusBadgeProps = {
  isPaused: boolean
}

function StatusBadge({ isPaused }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${
        isPaused
          ? 'bg-[color-mix(in_srgb,var(--silo-danger)_18%,transparent)] silo-text-main'
          : 'bg-[color-mix(in_srgb,var(--silo-success)_18%,transparent)] silo-text-main'
      }`}
    >
      {isPaused ? 'paused' : 'active'}
    </span>
  )
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; deployment: GlobalPauseDeployment; overview: GlobalPauseOverview }

export default function GlobalPauseSection() {
  const { account, chainId, provider, isConnected } = useWeb3()
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [refreshTick, setRefreshTick] = useState(0)
  const [busy, setBusy] = useState<'none' | 'pause' | 'unpause'>('none')
  const [txSuccess, setTxSuccess] = useState<GlobalPauseWriteSuccess | null>(null)
  const [txError, setTxError] = useState('')
  const [contractNames, setContractNames] = useState<Map<string, string>>(new Map())
  const [namesLoading, setNamesLoading] = useState(false)

  const effectiveChainId = chainId ?? null
  const chainSupported = effectiveChainId != null && isChainSupported(effectiveChainId)

  useEffect(() => {
    setTxSuccess(null)
    setTxError('')
  }, [effectiveChainId, account])

  useEffect(() => {
    if (!isConnected || !provider || effectiveChainId == null || !chainSupported) {
      setState({ kind: 'idle' })
      return
    }
    const abort = new AbortController()
    let cancelled = false
    setState({ kind: 'loading' })
    ;(async () => {
      try {
        const deployment = await fetchGlobalPauseAddress(effectiveChainId, { signal: abort.signal })
        const overview = await fetchGlobalPauseOverview(provider, deployment.address, account || null)
        if (cancelled) return
        setState({ kind: 'ready', deployment, overview })
      } catch (e) {
        if (cancelled) return
        setState({ kind: 'error', message: toUserErrorMessage(e, 'Could not load Global Pause.') })
      }
    })()
    return () => {
      cancelled = true
      abort.abort()
    }
  }, [isConnected, provider, effectiveChainId, chainSupported, account, refreshTick])

  useEffect(() => {
    if (state.kind !== 'ready') {
      setContractNames(new Map())
      setNamesLoading(false)
      return
    }
    const { deployment, overview } = state
    if (overview.allContracts.length === 0) {
      setContractNames(new Map())
      setNamesLoading(false)
      return
    }
    /** Skip the GitHub walker entirely for addresses covered by manual overrides — saves API budget. */
    const toResolve = filterAddressesWithoutOverride(deployment.chainId, overview.allContracts)
    if (toResolve.length === 0) {
      setContractNames(new Map())
      setNamesLoading(false)
      return
    }
    const abort = new AbortController()
    let cancelled = false
    setNamesLoading(true)
    ;(async () => {
      try {
        const names = await fetchGlobalPauseContractNames(deployment.chainName, toResolve, {
          signal: abort.signal,
        })
        if (!cancelled) setContractNames(names)
      } catch {
        /** Name lookup is best-effort — falling back to raw addresses is acceptable. */
        if (!cancelled) setContractNames(new Map())
      } finally {
        if (!cancelled) setNamesLoading(false)
      }
    })()
    return () => {
      cancelled = true
      abort.abort()
    }
  }, [state])

  const statusByAddress = useMemo(() => {
    if (state.kind !== 'ready') return new Map<string, boolean>()
    const m = new Map<string, boolean>()
    for (const s of state.overview.statuses) {
      const norm = normalizeOrNull(s.address)
      if (norm) m.set(norm, s.isPaused)
    }
    return m
  }, [state])

  const handlePauseAll = useCallback(async () => {
    if (state.kind !== 'ready' || !provider || effectiveChainId == null) return
    setTxError('')
    setTxSuccess(null)
    setBusy('pause')
    try {
      const signer = await provider.getSigner()
      const result = await pauseAllGlobal({
        signer,
        chainId: effectiveChainId,
        globalPauseAddress: state.deployment.address,
      })
      setTxSuccess(result)
      setRefreshTick((n) => n + 1)
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy('none')
    }
  }, [state, provider, effectiveChainId])

  const handleUnpauseAll = useCallback(async () => {
    if (state.kind !== 'ready' || !provider || effectiveChainId == null) return
    setTxError('')
    setTxSuccess(null)
    setBusy('unpause')
    try {
      const signer = await provider.getSigner()
      const result = await unpauseAllGlobal({
        signer,
        chainId: effectiveChainId,
        globalPauseAddress: state.deployment.address,
      })
      setTxSuccess(result)
      setRefreshTick((n) => n + 1)
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy('none')
    }
  }, [state, provider, effectiveChainId])

  if (!isConnected || !provider) {
    return (
      <SectionShell>
        <p className="text-sm silo-text-soft">
          Connect your wallet to load the Global Pause contract for the selected network.
        </p>
      </SectionShell>
    )
  }

  if (effectiveChainId == null || !chainSupported) {
    return (
      <SectionShell>
        <p className="text-sm silo-text-soft">
          {effectiveChainId == null
            ? 'No active network detected in your wallet.'
            : `Chain ${effectiveChainId} is not supported for Global Pause in this app.`}
        </p>
      </SectionShell>
    )
  }

  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <SectionShell networkLabel={getNetworkDisplayName(effectiveChainId)} networkChainId={effectiveChainId}>
        <p className="text-sm silo-text-soft">Loading Global Pause data…</p>
      </SectionShell>
    )
  }

  if (state.kind === 'error') {
    return (
      <SectionShell networkLabel={getNetworkDisplayName(effectiveChainId)} networkChainId={effectiveChainId}>
        <p className="text-sm silo-alert silo-alert-error">{state.message}</p>
        <button
          type="button"
          onClick={() => setRefreshTick((n) => n + 1)}
          className="silo-btn-primary mt-3"
        >
          Retry
        </button>
      </SectionShell>
    )
  }

  const { deployment, overview } = state
  const canPauseAll = overview.canPauseAll === true
  const permissionResolved = overview.canPauseAll != null
  const pauseCanAttempt = canPauseAll && busy === 'none'
  const unpauseCanAttempt = canPauseAll && busy === 'none'

  return (
    <SectionShell networkLabel={getNetworkDisplayName(effectiveChainId)} networkChainId={effectiveChainId}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
        <div className="min-w-0 space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <span className="text-xs font-semibold silo-text-soft shrink-0">Address:</span>
              <AddressLink chainId={effectiveChainId} address={deployment.address} />
              <span className="text-xs silo-text-soft shrink-0">source:</span>
              <a
                href={deployment.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:silo-text-main"
              >
                Silo deployments
              </a>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">Owner</p>
            <AddressLink chainId={effectiveChainId} address={overview.owner} />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
              Authorized to pause ({overview.authorizedToPause.length})
            </p>
            {overview.authorizedToPause.length === 0 ? (
              <p className="text-sm silo-text-soft">No addresses listed.</p>
            ) : (
              <ul className="space-y-1">
                {overview.authorizedToPause.map((addr) => (
                  <li key={addr} className="min-w-0">
                    <AddressLink chainId={effectiveChainId} address={addr} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
              Your permission
            </p>
            {!permissionResolved ? (
              <p className="text-sm silo-text-soft">Connect a wallet to see whether you can pause.</p>
            ) : (
              <p className="text-sm silo-text-main inline-flex items-center gap-2">
                {canPauseAll ? (
                  <>
                    <span>authorized to pause</span>
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--silo-success)]"
                      aria-label="authorized"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </>
                ) : (
                  <>
                    <span>not authorized to pause</span>
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--silo-danger)]"
                      aria-label="not authorized"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 lg:border-l lg:border-[var(--silo-border)] lg:pl-10 pt-6 lg:pt-0 border-t lg:border-t-0 border-[var(--silo-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-2">
            Contracts tracked by Global Pause ({overview.allContracts.length})
            {namesLoading ? <span className="ml-2 text-[10px] font-normal normal-case silo-text-soft">resolving names…</span> : null}
          </p>
          {overview.allContracts.length === 0 ? (
            <p className="text-sm silo-text-soft">No contracts registered yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--silo-border)]">
              {overview.allContracts.map((addr) => {
                const isPaused = statusByAddress.get(addr)
                const override = getGlobalPauseContractNameOverride(effectiveChainId, addr)
                const name = override ?? contractNames.get(addr.toLowerCase())
                return (
                  <li key={addr} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <AddressLink chainId={effectiveChainId} address={addr} />
                      {name ? (
                        <span className="text-sm font-medium silo-text-main truncate" title={name}>
                          {name}
                        </span>
                      ) : null}
                    </div>
                    {isPaused == null ? (
                      <span className="text-xs silo-text-soft shrink-0">status unknown</span>
                    ) : (
                      <StatusBadge isPaused={isPaused} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-6 space-y-4">
            <div>
              <button
                type="button"
                disabled={!pauseCanAttempt}
                onClick={() => void handlePauseAll()}
                className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed w-full"
              >
                {busy === 'pause' ? 'Waiting for wallet…' : 'Pause all'}
              </button>
            </div>

            <div>
              <button
                type="button"
                disabled={!unpauseCanAttempt}
                onClick={() => void handleUnpauseAll()}
                className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed w-full"
              >
                {busy === 'unpause' ? 'Waiting for wallet…' : 'Unpause all'}
              </button>
            </div>

            {txError ? <p className="text-sm silo-alert silo-alert-error">{txError}</p> : null}
            {txSuccess ? (
              <TransactionSuccessSummary
                url={txSuccess.transactionUrl}
                linkLabel={txSuccess.successLinkLabel}
                outcome={txSuccess.outcome}
              />
            ) : null}
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

function SectionShell({
  children,
  networkLabel,
  networkChainId,
}: {
  children: React.ReactNode
  networkLabel?: string
  networkChainId?: number | null
}) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const iconPath = networkChainId != null ? getNetworkIconPath(networkChainId) : null
  return (
    <div className="silo-panel silo-top-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold silo-text-main">Global Pause</h2>
        {networkLabel ? (
          <span className="inline-flex items-center gap-1.5 text-xs silo-text-soft">
            {iconPath ? (
              <Image
                src={`${basePath}${iconPath}`}
                alt=""
                width={14}
                height={14}
                className="h-3.5 w-3.5 rounded-full"
                aria-hidden
              />
            ) : null}
            {networkLabel}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}
