'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Contract, getAddress, type Provider } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import gnosisSafeArtifact from '@/abis/GnosisSafe.json'
import { useWeb3 } from '@/contexts/Web3Context'
import { getGlobalPauseContractNameOverride } from '@/config/globalPauseContractNameOverrides'
import {
  fetchGlobalPauseArtifactDigest,
  fetchGlobalPauseContractNames,
  type GlobalPauseArtifactRecord,
} from '@/utils/globalPauseContractNames'
import {
  fetchGlobalPauseTargetAuthority,
  type TargetAuthorityMap,
  type TargetAuthorityStatus,
} from '@/utils/globalPauseAuthority'
import { fetchGlobalPauseAddress, type GlobalPauseDeployment } from '@/utils/globalPauseDeployment'
import { fetchGlobalPauseOverview, type GlobalPauseOverview } from '@/utils/globalPauseReader'
import {
  executeRemediation,
  proposeBulkRemediationViaSafe,
  remediationButtonLabel,
} from '@/utils/globalPauseRemediation'
import {
  fetchGlobalPauseRemediationPlans,
  groupRemediationForBulk,
  type RemediationMap,
  type RemediationPlan,
} from '@/utils/globalPauseRemediationAuthority'
import { loadAbi } from '@/utils/loadAbi'
import {
  getExplorerAddressUrl,
  getNetworkDisplayName,
  getNetworkIconPath,
  isChainSupported,
} from '@/utils/networks'
import {
  acceptGlobalPauseContractOwnership,
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

type AuthorityWarningProps = {
  status: TargetAuthorityStatus
}

/**
 * Red warning triangle shown when Global Pause demonstrably cannot pause a tracked contract.
 * `authorized` / `pending-ownership` / `unknown` render nothing — the parent handles those.
 *
 * Uses a CSS tooltip (not the native `title` attribute) so the hint appears instantly on
 * hover/focus and follows Silo brand tokens instead of the OS default gray box.
 */
function AuthorityWarning({ status }: AuthorityWarningProps) {
  if (status.kind !== 'no-role' && status.kind !== 'not-owner') return null
  const message =
    status.kind === 'no-role'
      ? 'Global Pause does not have PAUSER_ROLE on this contract.'
      : 'Global Pause is neither owner nor pending owner of this contract.'
  return (
    <span
      className="silo-inline-warn"
      role="img"
      aria-label={message}
      tabIndex={0}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M12 3.2 1.5 21.2h21L12 3.2Zm0 5.1 7.8 13.4H4.2L12 8.3Zm-1 5.1v4.2h2v-4.2h-2Zm0 5.2v1.8h2v-1.8h-2Z" />
      </svg>
      <span className="silo-tooltip" role="tooltip">
        {message}
      </span>
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
  const { account, chainId, provider, eip1193Provider, isConnected } = useWeb3()
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  const [refreshTick, setRefreshTick] = useState(0)
  const [busy, setBusy] = useState<
    'none' | 'pause' | 'unpause' | 'add' | 'remove' | 'accept' | 'remediate' | 'bulk_remediate'
  >('none')
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
  const [suggestedContracts, setSuggestedContracts] = useState<GlobalPauseArtifactRecord[]>([])
  const [quickAddPending, setQuickAddPending] = useState<string | null>(null)
  const [authorityByAddress, setAuthorityByAddress] = useState<TargetAuthorityMap>(new Map())
  const [acceptPendingAddress, setAcceptPendingAddress] = useState<string | null>(null)
  const [remediationByAddress, setRemediationByAddress] = useState<RemediationMap>(new Map())
  const [remediatePendingAddress, setRemediatePendingAddress] = useState<string | null>(null)

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
    setAcceptPendingAddress(null)
    setRemediatePendingAddress(null)
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
      setSuggestedContracts([])
      return
    }
    const { deployment, overview } = state
    const abort = new AbortController()
    let cancelled = false
    setNamesLoading(true)
    ;(async () => {
      try {
        /**
         * Single artifact walk per chain/session: the digest feeds both name resolution for
         * already-tracked contracts and the pause-capable suggestion list below.
         */
        const digest = await fetchGlobalPauseArtifactDigest(deployment.chainName, {
          signal: abort.signal,
        })
        if (cancelled) return

        const trackedLc = new Set<string>()
        const names = new Map<string, string>()
        for (const addr of overview.allContracts) {
          const lc = addr.toLowerCase()
          trackedLc.add(lc)
          /** Manual overrides win over walker-derived names — skip lookup to save allocation. */
          if (getGlobalPauseContractNameOverride(deployment.chainId, addr)) continue
          const rec = digest.byAddressLc.get(lc)
          if (rec) names.set(lc, rec.name)
        }
        setContractNames(names)

        const suggestions = digest.pauseCapable.filter(
          (r) => !trackedLc.has(r.address.toLowerCase())
        )
        setSuggestedContracts(suggestions)
      } catch {
        /** Walker is best-effort — surface raw addresses with no suggestions on failure. */
        if (!cancelled) {
          setContractNames(new Map())
          setSuggestedContracts([])
        }
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
    if (state.kind !== 'ready' || !provider) {
      setAuthorityByAddress(new Map())
      return
    }
    const { deployment, overview } = state
    if (overview.allContracts.length === 0) {
      setAuthorityByAddress(new Map())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const map = await fetchGlobalPauseTargetAuthority(
          provider,
          deployment.address,
          overview.allContracts
        )
        if (!cancelled) setAuthorityByAddress(map)
      } catch {
        /** Best-effort probe: swallow RPC failures so the list still renders without badges. */
        if (!cancelled) setAuthorityByAddress(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state, provider])

  /**
   * Remediation plans (Transfer ownership / Grant role) for targets that came back as
   * `not-owner` or `no-role`. Skipped when `authorityByAddress` has no actionable targets or the
   * wallet is not connected — we need `account` to decide between `direct` and `safe_propose`.
   */
  useEffect(() => {
    if (state.kind !== 'ready' || !provider || !account) {
      setRemediationByAddress(new Map())
      return
    }
    const targets: { address: string; status: TargetAuthorityStatus }[] = []
    for (const addr of state.overview.allContracts) {
      const status = authorityByAddress.get(addr.toLowerCase())
      if (!status) continue
      if (status.kind === 'not-owner' || status.kind === 'no-role') {
        targets.push({ address: addr, status })
      }
    }
    if (targets.length === 0) {
      setRemediationByAddress(new Map())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const plans = await fetchGlobalPauseRemediationPlans(provider, account, targets)
        if (!cancelled) setRemediationByAddress(plans)
      } catch {
        if (!cancelled) setRemediationByAddress(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state, provider, account, authorityByAddress])

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

  const bulkRemediation = useMemo(
    () => groupRemediationForBulk(remediationByAddress),
    [remediationByAddress]
  )

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

  const handleAcceptOwnership = useCallback(
    async (contractAddress: string) => {
      if (state.kind !== 'ready' || !provider || effectiveChainId == null) return
      setTxError('')
      setTxSuccess(null)
      setBusy('accept')
      setAcceptPendingAddress(contractAddress)
      try {
        const signer = await provider.getSigner()
        const result = await acceptGlobalPauseContractOwnership({
          signer,
          chainId: effectiveChainId,
          globalPauseAddress: state.deployment.address,
          contractAddress,
        })
        setTxSuccess(result)
        setRefreshTick((n) => n + 1)
      } catch (e) {
        setTxError(toUserErrorMessage(e))
      } finally {
        setBusy('none')
        setAcceptPendingAddress(null)
      }
    },
    [state, provider, effectiveChainId]
  )

  const handleRemediate = useCallback(
    async (plan: RemediationPlan) => {
      if (state.kind !== 'ready' || !provider || effectiveChainId == null || !account) return
      setTxError('')
      setTxSuccess(null)
      setBusy('remediate')
      setRemediatePendingAddress(plan.target)
      try {
        const signer = await provider.getSigner()
        const result = await executeRemediation({
          signer,
          ethereum: eip1193Provider,
          chainId: effectiveChainId,
          connectedAccount: account,
          globalPauseAddress: state.deployment.address,
          plan,
        })
        setTxSuccess(result)
        setRefreshTick((n) => n + 1)
      } catch (e) {
        setTxError(toUserErrorMessage(e))
      } finally {
        setBusy('none')
        setRemediatePendingAddress(null)
      }
    },
    [state, provider, eip1193Provider, effectiveChainId, account]
  )

  const handleBulkRemediate = useCallback(
    async (safeAddress: string, plans: RemediationPlan[]) => {
      if (state.kind !== 'ready' || effectiveChainId == null || !account || !eip1193Provider) return
      setTxError('')
      setTxSuccess(null)
      setBusy('bulk_remediate')
      try {
        const result = await proposeBulkRemediationViaSafe({
          ethereum: eip1193Provider,
          chainId: effectiveChainId,
          safeAddress,
          proposerAccount: account,
          plans,
          globalPauseAddress: state.deployment.address,
        })
        setTxSuccess(result)
        setRefreshTick((n) => n + 1)
      } catch (e) {
        setTxError(toUserErrorMessage(e))
      } finally {
        setBusy('none')
      }
    },
    [state, eip1193Provider, effectiveChainId, account]
  )

  const handleQuickAddSuggestion = useCallback(
    async (contractAddress: string) => {
      if (state.kind !== 'ready' || !provider || effectiveChainId == null) return
      setTxError('')
      setTxSuccess(null)
      setBusy('add')
      setQuickAddPending(contractAddress)
      try {
        const signer = await provider.getSigner()
        const result = await addGlobalPauseContract({
          signer,
          chainId: effectiveChainId,
          globalPauseAddress: state.deployment.address,
          contractAddress,
        })
        setTxSuccess(result)
        setRefreshTick((n) => n + 1)
      } catch (e) {
        setTxError(toUserErrorMessage(e))
      } finally {
        setBusy('none')
        setQuickAddPending(null)
      }
    },
    [state, provider, effectiveChainId]
  )

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
  /**
   * Count contracts on the tracked list that lack pause authority (or need an owner handshake).
   * `pauseAll` on-chain skips failing contracts rather than reverting — surfacing a heads-up
   * keeps users from assuming the buttons are broken when some rows are flagged.
   */
  const unauthorizedTrackedCount = overview.allContracts.reduce((acc, addr) => {
    const status = authorityByAddress.get(addr.toLowerCase())
    if (!status) return acc
    if (
      status.kind === 'no-role' ||
      status.kind === 'not-owner' ||
      status.kind === 'pending-ownership'
    ) {
      return acc + 1
    }
    return acc
  }, 0)

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
                const authority = authorityByAddress.get(addr.toLowerCase())
                const plan = remediationByAddress.get(addr.toLowerCase())
                /**
                 * Show the per-row remediation button only when we're NOT aggregating into a
                 * single bulk Safe proposal (otherwise the UI would duplicate the CTA). Plans in
                 * `denied` mode still render the warning triangle with no button.
                 */
                const showRowRemediate =
                  plan != null &&
                  plan.mode.kind !== 'denied' &&
                  bulkRemediation.kind !== 'single_safe_batch'
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
                      {authority?.kind === 'pending-ownership' ? (
                        <button
                          type="button"
                          className="silo-btn-accept-ownership"
                          disabled={busy !== 'none'}
                          onClick={() => void handleAcceptOwnership(addr)}
                        >
                          {busy === 'accept' && acceptPendingAddress === addr ? '…' : 'Accept Ownership'}
                        </button>
                      ) : authority ? (
                        <AuthorityWarning status={authority} />
                      ) : null}
                      {showRowRemediate && plan ? (
                        <button
                          type="button"
                          className="silo-btn-remediate"
                          disabled={busy !== 'none'}
                          onClick={() => void handleRemediate(plan)}
                        >
                          {busy === 'remediate' && remediatePendingAddress === addr
                            ? '…'
                            : remediationButtonLabel(plan)}
                        </button>
                      ) : null}
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

          {suggestedContracts.length > 0 ? (
            <div className="mt-4 pt-3 border-t border-[var(--silo-border)] opacity-90">
              <p className="text-[11px] font-semibold uppercase tracking-wide silo-text-soft mb-2">
                Suggested contracts to add ({suggestedContracts.length})
              </p>
              <ul className="divide-y divide-[var(--silo-border)]">
                {suggestedContracts.map((rec) => (
                  <li key={rec.address} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="flex items-center gap-3 min-w-0 silo-text-soft">
                      <AddressLink chainId={effectiveChainId} address={rec.address} mono />
                      <span className="text-sm truncate" title={rec.name}>
                        {rec.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="silo-btn-icon-success"
                      aria-label={`Add ${rec.name} to Global Pause`}
                      title={
                        canAddContracts
                          ? 'Add to Global Pause'
                          : permissionResolved
                            ? 'Only authorized accounts can add contracts.'
                            : 'Checking permission…'
                      }
                      disabled={busy !== 'none' || !canAddContracts}
                      onClick={() => void handleQuickAddSuggestion(rec.address)}
                    >
                      {busy === 'add' && quickAddPending === rec.address ? '…' : '+'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            {unauthorizedTrackedCount > 0 ? (
              <p className="silo-alert silo-alert-warning text-sm">
                {unauthorizedTrackedCount === 1
                  ? '1 contract above does not currently grant Global Pause authority.'
                  : `${unauthorizedTrackedCount} contracts above do not currently grant Global Pause authority.`}{' '}
                Pause all / Unpause all will skip{' '}
                {unauthorizedTrackedCount === 1 ? 'it' : 'them'} and still run for the remaining
                tracked contracts.
              </p>
            ) : null}
            {bulkRemediation.kind === 'single_safe_batch' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  className="silo-btn-remediate-lg w-full"
                  disabled={busy !== 'none'}
                  onClick={() =>
                    void handleBulkRemediate(bulkRemediation.safeAddress, bulkRemediation.items)
                  }
                >
                  {busy === 'bulk_remediate'
                    ? 'Waiting for wallet…'
                    : `Fix authority for contracts (${bulkRemediation.items.length})`}
                </button>
                <ul className="text-xs silo-text-soft space-y-0.5 pl-1">
                  {bulkRemediation.items.map((item) => {
                    const lower = item.target.toLowerCase()
                    const override = getGlobalPauseContractNameOverride(
                      effectiveChainId,
                      item.target
                    )
                    const label = override ?? contractNames.get(lower) ?? shortAddr(item.target)
                    const verb =
                      item.action.kind === 'grantRole'
                        ? 'grant pausing role'
                        : 'transfer ownership of'
                    return (
                      <li key={item.target}>
                        – {verb} <span className="silo-text-main font-medium">{label}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
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
