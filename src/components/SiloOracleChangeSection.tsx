'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAddress, type BrowserProvider } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import {
  classifyManageableOracleAction,
  executeManageableOracleAction,
  MANAGEABLE_ORACLE_DENIED_MESSAGE,
  type ManageableOracleActionSuccess,
  type ManageableOracleAuthority,
} from '@/utils/manageableOracleAction'
import type { ManageableOracleState } from '@/utils/manageableOracleReader'
import { getExplorerAddressUrl } from '@/utils/networks'
import type { OwnerKind } from '@/utils/ownerKind'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'

type Props = {
  chainId: number
  /** `null` when the input was a single Silo (no index label needed). `0` / `1` for SiloConfig. */
  siloIndex: number | null
  /** Underlying asset symbol resolved from `ERC20.symbol()` via `readSiloConfigEntries`. */
  siloSymbol: string | null
  oracleState: ManageableOracleState | null
  ownerKind: OwnerKind | null
  /** `true` while the parent is still fetching the solvency oracle state for this silo. */
  loading: boolean
  /** Human-readable error from the parent's lazy oracle-state fetch (or null on success). */
  errorMessage: string | null
  provider: BrowserProvider | null
  eip1193Provider: Eip1193Provider | null
  connectedAccount: string
  revertingOracleAddress: `0x${string}` | null
  onActionSuccess: () => void
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AddressLine({ chainId, address }: { chainId: number; address: string }) {
  const url = getExplorerAddressUrl(chainId, address)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm silo-text-main hover:underline"
        title={address}
      >
        {shortAddr(address)}
      </a>
      <CopyButton value={address} />
    </span>
  )
}

function formatValidAt(validAtSeconds: number): string {
  if (!Number.isFinite(validAtSeconds) || validAtSeconds <= 0) return '—'
  try {
    return new Date(validAtSeconds * 1000).toISOString().replace('T', ' ').replace('.000Z', 'Z')
  } catch {
    return String(validAtSeconds)
  }
}

type Busy = 'idle' | 'propose' | 'cancel'

export default function SiloOracleChangeSection({
  chainId,
  siloIndex,
  siloSymbol,
  oracleState,
  ownerKind,
  loading,
  errorMessage,
  provider,
  eip1193Provider,
  connectedAccount,
  revertingOracleAddress,
  onActionSuccess,
}: Props) {
  const [busy, setBusy] = useState<Busy>('idle')
  const [txError, setTxError] = useState('')
  const [txSuccess, setTxSuccess] = useState<ManageableOracleActionSuccess | null>(null)
  const [authority, setAuthority] = useState<ManageableOracleAuthority | null>(null)
  const [authorityLoading, setAuthorityLoading] = useState(false)

  useEffect(() => {
    setTxError('')
    setTxSuccess(null)
  }, [oracleState?.oracleAddress])

  /**
   * Resolving the authority needs `analyzeOwnerKind` (done upstream) + a Safe-owner membership
   * check. We only classify when the oracle is Manageable and has an owner — otherwise the
   * action section is hidden anyway.
   */
  useEffect(() => {
    if (!provider || !oracleState || !oracleState.isManageable || !oracleState.owner || !ownerKind) {
      setAuthority(null)
      return
    }
    if (!connectedAccount) {
      setAuthority({ mode: 'denied', executingSafeAddress: null })
      return
    }
    let cancelled = false
    setAuthorityLoading(true)
    void (async () => {
      try {
        const result = await classifyManageableOracleAction(
          provider,
          connectedAccount,
          oracleState.owner!,
          ownerKind
        )
        if (!cancelled) setAuthority(result)
      } catch {
        if (!cancelled) setAuthority({ mode: 'denied', executingSafeAddress: null })
      } finally {
        if (!cancelled) setAuthorityLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, oracleState, ownerKind, connectedAccount])

  const runAction = useCallback(
    async (method: 'proposeOracle' | 'cancelOracle') => {
      if (!provider || !eip1193Provider || !connectedAccount || !oracleState?.isManageable || !oracleState.owner || !ownerKind) {
        return
      }
      if (method === 'proposeOracle' && !revertingOracleAddress) return
      setTxError('')
      setTxSuccess(null)
      setBusy(method === 'proposeOracle' ? 'propose' : 'cancel')
      try {
        const signer = await provider.getSigner()
        const result = await executeManageableOracleAction({
          ethereum: eip1193Provider,
          provider,
          signer,
          chainId,
          connectedAccount,
          ownerAddress: oracleState.owner,
          ownerKind,
          call: {
            oracleAddress: oracleState.oracleAddress,
            method,
            newOracle: method === 'proposeOracle' ? (revertingOracleAddress ?? undefined) : undefined,
          },
        })
        setTxSuccess(result)
        onActionSuccess()
      } catch (e) {
        setTxError(toUserErrorMessage(e))
      } finally {
        setBusy('idle')
      }
    },
    [provider, eip1193Provider, connectedAccount, oracleState, ownerKind, chainId, revertingOracleAddress, onActionSuccess]
  )

  const siloName = siloIndex == null ? 'Silo' : `Silo${siloIndex}`
  const symbolSuffix = siloSymbol ? ` · ${siloSymbol}` : ''
  const title = `${siloName}${symbolSuffix} — solvency oracle`

  if (loading || !oracleState) {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>
        {errorMessage ? (
          <p className="text-sm silo-alert silo-alert-error mt-3 m-0">{errorMessage}</p>
        ) : (
          <p className="text-sm silo-text-soft mt-3 m-0">Loading solvency oracle…</p>
        )}
      </section>
    )
  }

  if (!oracleState.oracleAddress || oracleState.oracleAddress === '0x0000000000000000000000000000000000000000') {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>
        <p className="text-sm silo-alert silo-alert-warning mt-3 m-0">
          This silo has no solvency oracle configured — nothing to update.
        </p>
      </section>
    )
  }

  const pending = oracleState.pendingOracle

  return (
    <section className="silo-panel p-5 space-y-4">
      <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>

      {/* Row 4: oracle card */}
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Solvency oracle</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AddressLine chainId={chainId} address={oracleState.oracleAddress} />
          <span className="text-xs">
            <span className="silo-text-soft">·</span>{' '}
            <span className="font-mono silo-text-main">
              {oracleState.versionString ?? '(no VERSION() method)'}
            </span>
          </span>
        </div>
        {oracleState.isManageable ? null : (
          <p className="text-sm silo-alert silo-alert-error m-0 mt-1">
            Solvency oracle is not a ManageableOracle — cannot change it here.
          </p>
        )}
      </div>

      {oracleState.isManageable ? (
        <>
          {/* Row 5: owner panel */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Owner</p>
            {oracleState.owner ? (
              <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AddressLine chainId={chainId} address={oracleState.owner} />
                  <span className="text-xs silo-text-main">
                    <span className="silo-text-soft">·</span>{' '}
                    <span className="font-medium">
                      {ownerKind === 'safe' ? 'Safe (multisig)' : ownerKind === 'eoa' ? 'EOA' : ownerKind === 'contract' ? 'Contract' : '—'}
                    </span>
                  </span>
                </div>
                {ownerKind === 'safe' && connectedAccount ? (
                  <p className="text-xs m-0">
                    {authorityLoading ? (
                      <span className="silo-text-soft">Checking signer status…</span>
                    ) : authority?.mode === 'safe_as_wallet' ? (
                      <span className="silo-text-main">Connected wallet is this Safe (sends a Safe proposal).</span>
                    ) : authority?.mode === 'safe_propose' ? (
                      <span className="silo-text-main inline-flex items-center gap-1">
                        You are a signer on this Safe.
                        <span className="text-[var(--silo-success)] font-semibold leading-none" aria-hidden>
                          ✓
                        </span>
                      </span>
                    ) : (
                      <span className="silo-alert silo-alert-warning inline-block px-2 py-0.5 rounded">
                        You are not a signer on this Safe.
                      </span>
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm silo-text-soft m-0">Owner not available.</p>
            )}
          </div>

          {/* Row 6: pending oracle panel (only when present) */}
          {pending ? (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Pending oracle</p>
              <AddressLine chainId={chainId} address={pending.value} />
              <p className="text-xs silo-text-soft m-0">
                Valid at (unix):{' '}
                <span className="font-mono silo-text-main">{pending.validAt}</span>
                {' · '}
                <span className="font-mono silo-text-main">{formatValidAt(pending.validAt)}</span>
              </p>
            </div>
          ) : null}

          {/* Row 7: action */}
          <div className="space-y-2">
            {pending ? (
              <>
                <button
                  type="button"
                  className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={busy !== 'idle' || authorityLoading || !authority || authority.mode === 'denied'}
                  onClick={() => void runAction('cancelOracle')}
                >
                  {busy === 'cancel' ? 'Waiting for wallet…' : 'Cancel pending oracle'}
                </button>
                <ActionPermissionHint
                  allowed={authority != null && authority.mode !== 'denied'}
                  onlyForLabel="oracle owner (directly or as a Safe signer)"
                />
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={
                    busy !== 'idle' ||
                    authorityLoading ||
                    !authority ||
                    authority.mode === 'denied' ||
                    !revertingOracleAddress
                  }
                  onClick={() => void runAction('proposeOracle')}
                >
                  {busy === 'propose'
                    ? 'Waiting for wallet…'
                    : revertingOracleAddress
                      ? `Propose RevertingOracle (${shortAddr(getAddress(revertingOracleAddress))})`
                      : 'RevertingOracle not available on this chain'}
                </button>
                <ActionPermissionHint
                  allowed={authority != null && authority.mode !== 'denied'}
                  onlyForLabel="oracle owner (directly or as a Safe signer)"
                />
              </>
            )}
            {authority?.mode === 'denied' && !authorityLoading ? (
              <p className="text-xs silo-alert silo-alert-error m-0">{MANAGEABLE_ORACLE_DENIED_MESSAGE}</p>
            ) : null}
            {txError ? <p className="text-sm silo-alert silo-alert-error m-0">{txError}</p> : null}
            {txSuccess ? (
              <TransactionSuccessSummary
                url={txSuccess.transactionUrl}
                linkLabel={txSuccess.successLinkLabel}
                outcome={txSuccess.outcome}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
