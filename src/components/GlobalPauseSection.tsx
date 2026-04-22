'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Contract, getAddress, type Provider } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import gnosisSafeArtifact from '@/abis/GnosisSafe.json'
import { useWeb3 } from '@/contexts/Web3Context'
import {
  filterAddressesWithoutOverride,
  getGlobalPauseContractNameOverride,
} from '@/config/globalPauseContractNameOverrides'
import { fetchGlobalPauseContractNames } from '@/utils/globalPauseContractNames'
import { fetchGlobalPauseAddress, type GlobalPauseDeployment } from '@/utils/globalPauseDeployment'
import { fetchGlobalPauseOverview, type GlobalPauseOverview } from '@/utils/globalPauseReader'
import { loadAbi } from '@/utils/loadAbi'
import {
  getExplorerAddressUrl,
  getNetworkDisplayName,
  getNetworkIconPath,
  isChainSupported,
} from '@/utils/networks'
import {
  addGlobalPauseContract,
  pauseAllGlobal,
  removeGlobalPauseContract,
  unpauseAllGlobal,
  type GlobalPauseWriteSuccess,
} from '@/utils/pauseAllGlobal'
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

const gnosisSafeAbi = loadAbi(gnosisSafeArtifact)

async function fetchSafeOwners(provider: Provider, safeAddress: string): Promise<string[]> {
  try {
    const safe = new Contract(safeAddress, gnosisSafeAbi, provider)
    const rawOwners = (await safe.getOwners()) as unknown
    if (!Array.isArray(rawOwners)) return []
    const owners: string[] = []
    for (const item of rawOwners) {
      try {
        owners.push(getAddress(String(item)))
      } catch {
        // ignore malformed entries from non-standard wallets
      }
    }
    return owners
  } catch {
    return []
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
  const [busy, setBusy] = useState<'none' | 'pause' | 'unpause' | 'add' | 'remove'>('none')
  const [txSuccess, setTxSuccess] = useState<GlobalPauseWriteSuccess | null>(null)
  const [txError, setTxError] = useState('')
  const [contractNames, setContractNames] = useState<Map<string, string>>(new Map())
  const [namesLoading, setNamesLoading] = useState(false)
  const [multisigSigners, setMultisigSigners] = useState<string[]>([])
  const [multisigSignersLoading, setMultisigSignersLoading] = useState(false)
  const [addRowOpen, setAddRowOpen] = useState(false)
  const [addContractInput, setAddContractInput] = useState('')
  const [addCheckStatus, setAddCheckStatus] = useState<
    'idle' | 'invalid' | 'checking' | 'not_contract' | 'duplicate' | 'ready'
  >('idle')
  const [addResolvedName, setAddResolvedName] = useState<string | null>(null)
  const [addNameLookupPending, setAddNameLookupPending] = useState(false)
  const [removePendingAddress, setRemovePendingAddress] = useState<string | null>(null)

  const effectiveChainId = chainId ?? null
  const chainSupported = effectiveChainId != null && isChainSupported(effectiveChainId)

  useEffect(() => {
    setTxSuccess(null)
    setTxError('')
    setAddRowOpen(false)
    setAddContractInput('')
    setAddCheckStatus('idle')
    setAddResolvedName(null)
    setAddNameLookupPending(false)
    setRemovePendingAddress(null)
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

  useEffect(() => {
    if (!addRowOpen || state.kind !== 'ready' || !provider) {
      setAddCheckStatus('idle')
      setAddResolvedName(null)
      setAddNameLookupPending(false)
      return
    }
    const raw = addContractInput.trim()
    if (raw.length === 0) {
      setAddCheckStatus('idle')
      setAddResolvedName(null)
      setAddNameLookupPending(false)
      return
    }
    const norm = normalizeOrNull(raw)
    if (!norm) {
      setAddCheckStatus('invalid')
      setAddResolvedName(null)
      setAddNameLookupPending(false)
      return
    }
    const isDuplicate = state.overview.allContracts.some((a) => normalizeOrNull(a) === norm)
    if (isDuplicate) {
      setAddCheckStatus('duplicate')
      setAddResolvedName(null)
      setAddNameLookupPending(false)
      return
    }

    const deployment = state.deployment
    let cancelled = false
    setAddCheckStatus('checking')
    setAddResolvedName(null)
    setAddNameLookupPending(false)
    const timer = window.setTimeout(() => {
      void (async () => {
        let code = '0x'
        try {
          code = await provider.getCode(norm)
        } catch {
          if (!cancelled) setAddCheckStatus('not_contract')
          return
        }
        if (cancelled) return
        if (!code || code === '0x') {
          setAddCheckStatus('not_contract')
          return
        }
        const override = getGlobalPauseContractNameOverride(deployment.chainId, norm)
        if (override) {
          setAddCheckStatus('ready')
          setAddResolvedName(override)
          return
        }
        setAddCheckStatus('ready')
        setAddNameLookupPending(true)
        try {
          const names = await fetchGlobalPauseContractNames(deployment.chainName, [norm])
          if (cancelled) return
          const name = names.get(norm.toLowerCase()) ?? null
          setAddResolvedName(name)
        } catch {
          if (!cancelled) setAddResolvedName(null)
        } finally {
          if (!cancelled) setAddNameLookupPending(false)
        }
      })()
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [addRowOpen, addContractInput, provider, state])

  useEffect(() => {
    if (state.kind !== 'ready' || !provider) {
      setMultisigSigners([])
      setMultisigSignersLoading(false)
      return
    }
    let cancelled = false
    setMultisigSignersLoading(true)
    ;(async () => {
      try {
        const owners = await fetchSafeOwners(provider, state.overview.owner)
        if (!cancelled) setMultisigSigners(owners)
      } finally {
        if (!cancelled) setMultisigSignersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state, provider])

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
  const accountNorm = account ? normalizeOrNull(account) : null
  const ownerNorm = normalizeOrNull(overview.owner)
  const canRemoveContracts = accountNorm != null && ownerNorm != null && accountNorm === ownerNorm
  const canAddContracts = canPauseAll
  const addInputNorm = normalizeOrNull(addContractInput.trim())
  const addSubmitReady = addCheckStatus === 'ready' && addInputNorm != null
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
              Multisig signers ({multisigSigners.length})
              {multisigSignersLoading ? (
                <span className="ml-2 text-[10px] font-normal normal-case silo-text-soft">loading…</span>
              ) : null}
            </p>
            {multisigSigners.length === 0 ? (
              <p className="text-sm silo-text-soft">No multisig signers detected for the current owner address.</p>
            ) : (
              <ul className="space-y-1">
                {multisigSigners.map((addr) => (
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft">
              Contracts tracked by Global Pause ({overview.allContracts.length})
              {namesLoading ? (
                <span className="ml-2 text-[10px] font-normal normal-case silo-text-soft">resolving names…</span>
              ) : null}
            </p>
            <button
              type="button"
              className="silo-btn-icon"
              aria-label="Add contract to Global Pause"
              title={
                canAddContracts
                  ? 'Add contract'
                  : permissionResolved
                    ? 'Only authorized accounts can add contracts.'
                    : 'Checking permission…'
              }
              disabled={!canAddContracts || busy !== 'none'}
              onClick={() => {
                setTxError('')
                setTxSuccess(null)
                setAddRowOpen((open) => !open)
              }}
            >
              +
            </button>
          </div>

          {addRowOpen ? (
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <input
                    type="text"
                    value={addContractInput}
                    onChange={(e) => setAddContractInput(e.target.value)}
                    placeholder="0x… contract address"
                    className="w-full silo-input silo-input--md pr-10 font-mono text-sm focus:outline-none focus:ring-0"
                    aria-label="Contract address to add"
                  />
                  <button
                    type="button"
                    className="silo-inline-dismiss absolute right-1 top-1/2 -translate-y-1/2"
                    aria-label="Close add contract"
                    title="Close"
                    onClick={() => {
                      setAddRowOpen(false)
                      setAddContractInput('')
                    }}
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  className="silo-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={busy !== 'none' || !addSubmitReady}
                  onClick={() => {
                    void (async () => {
                      if (state.kind !== 'ready' || !provider || effectiveChainId == null || !addSubmitReady || addInputNorm == null) return
                      setTxError('')
                      setTxSuccess(null)
                      setBusy('add')
                      try {
                        const signer = await provider.getSigner()
                        const result = await addGlobalPauseContract({
                          signer,
                          chainId: effectiveChainId,
                          globalPauseAddress: state.deployment.address,
                          contractAddress: addInputNorm,
                        })
                        setTxSuccess(result)
                        setAddContractInput('')
                        setAddRowOpen(false)
                        setRefreshTick((n) => n + 1)
                      } catch (e) {
                        setTxError(toUserErrorMessage(e))
                      } finally {
                        setBusy('none')
                      }
                    })()
                  }}
                >
                  {busy === 'add' ? 'Waiting…' : 'Add'}
                </button>
              </div>
              {addCheckStatus === 'checking' ? (
                <p className="text-xs silo-text-soft">Checking address…</p>
              ) : null}
              {addCheckStatus === 'invalid' ? (
                <p className="text-xs silo-alert silo-alert-error">Enter a valid contract address.</p>
              ) : null}
              {addCheckStatus === 'duplicate' ? (
                <p className="text-xs silo-alert silo-alert-error">This contract is already tracked by Global Pause.</p>
              ) : null}
              {addCheckStatus === 'not_contract' ? (
                <p className="text-xs silo-alert silo-alert-error">
                  This address has no deployed code on the current network.
                </p>
              ) : null}
              {addCheckStatus === 'ready' ? (
                addNameLookupPending ? (
                  <p className="text-xs silo-text-soft">Looking up name in Silo deployments…</p>
                ) : addResolvedName ? (
                  <p className="text-xs silo-text-main">
                    <span className="silo-text-soft">Matched Silo deployment: </span>
                    <span className="font-medium">{addResolvedName}</span>
                  </p>
                ) : (
                  <p className="text-xs silo-text-soft">
                    Not found in Silo deployments — you can still add it.
                  </p>
                )
              ) : null}
            </div>
          ) : null}

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
                    <div className="flex items-center gap-2 shrink-0">
                      {isPaused == null ? (
                        <span className="text-xs silo-text-soft">status unknown</span>
                      ) : (
                        <StatusBadge isPaused={isPaused} />
                      )}
                      <button
                        type="button"
                        className="silo-inline-dismiss"
                        aria-label={`Remove ${addr} from Global Pause`}
                        title={canRemoveContracts ? 'Remove contract' : 'Only Global Pause owner can remove contracts.'}
                        disabled={busy !== 'none' || !canRemoveContracts}
                        onClick={() => {
                          void (async () => {
                            if (state.kind !== 'ready' || !provider || effectiveChainId == null) return
                            setTxError('')
                            setTxSuccess(null)
                            setBusy('remove')
                            setRemovePendingAddress(addr)
                            try {
                              const signer = await provider.getSigner()
                              const result = await removeGlobalPauseContract({
                                signer,
                                chainId: effectiveChainId,
                                globalPauseAddress: state.deployment.address,
                                contractAddress: addr,
                              })
                              setTxSuccess(result)
                              setRefreshTick((n) => n + 1)
                            } catch (e) {
                              setTxError(toUserErrorMessage(e))
                            } finally {
                              setBusy('none')
                              setRemovePendingAddress(null)
                            }
                          })()
                        }}
                      >
                        {busy === 'remove' && removePendingAddress === addr ? '…' : '×'}
                      </button>
                    </div>
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
