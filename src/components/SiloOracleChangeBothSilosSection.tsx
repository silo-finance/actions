'use client'

import { useCallback, useEffect, useState } from 'react'
import type { BrowserProvider } from 'ethers'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import {
  classifyManageableOracleAction,
  executeManageableOracleBatch,
  MANAGEABLE_ORACLE_DENIED_MESSAGE,
  type ManageableOracleActionSuccess,
  type ManageableOracleAuthority,
} from '@/utils/manageableOracleAction'
import type { ManageableOracleState, SiloSolvencyOracle } from '@/utils/manageableOracleReader'
import type { OwnerKind } from '@/utils/ownerKind'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { toUserErrorMessage } from '@/utils/rpcErrors'

type LoadedSilo = SiloSolvencyOracle & {
  oracleState: ManageableOracleState | null
  ownerKind: OwnerKind | null
}

type Props = {
  chainId: number
  silos: LoadedSilo[]
  provider: BrowserProvider | null
  eip1193Provider: Eip1193Provider | null
  connectedAccount: string
  revertingOracleAddress: `0x${string}` | null
  onActionSuccess: () => void
}

type Eligibility =
  | { kind: 'ok'; owner: string; ownerKind: OwnerKind }
  | { kind: 'not_manageable' }
  | { kind: 'owners_differ'; owner0: string; owner1: string }
  | { kind: 'pending_present' }
  | { kind: 'no_reverting_oracle' }
  | { kind: 'incomplete' }

function computeEligibility(silos: LoadedSilo[], revertingOracleAddress: `0x${string}` | null): Eligibility {
  if (silos.length !== 2) return { kind: 'incomplete' }
  const [a, b] = silos
  if (!a?.oracleState || !b?.oracleState || !a.ownerKind || !b.ownerKind) return { kind: 'incomplete' }
  if (!a.oracleState.isManageable || !b.oracleState.isManageable) return { kind: 'not_manageable' }
  if (a.oracleState.pendingOracle || b.oracleState.pendingOracle) return { kind: 'pending_present' }
  if (!a.oracleState.owner || !b.oracleState.owner) return { kind: 'incomplete' }
  if (a.oracleState.owner.toLowerCase() !== b.oracleState.owner.toLowerCase()) {
    return { kind: 'owners_differ', owner0: a.oracleState.owner, owner1: b.oracleState.owner }
  }
  if (a.ownerKind !== b.ownerKind) {
    /** Should not happen if addresses match — belt-and-suspenders. */
    return { kind: 'owners_differ', owner0: a.oracleState.owner, owner1: b.oracleState.owner }
  }
  if (!revertingOracleAddress) return { kind: 'no_reverting_oracle' }
  return { kind: 'ok', owner: a.oracleState.owner, ownerKind: a.ownerKind }
}

export default function SiloOracleChangeBothSilosSection({
  chainId,
  silos,
  provider,
  eip1193Provider,
  connectedAccount,
  revertingOracleAddress,
  onActionSuccess,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [txError, setTxError] = useState('')
  const [txSuccess, setTxSuccess] = useState<ManageableOracleActionSuccess | null>(null)
  const [authority, setAuthority] = useState<ManageableOracleAuthority | null>(null)
  const [authorityLoading, setAuthorityLoading] = useState(false)

  const eligibility = computeEligibility(silos, revertingOracleAddress)
  const oracle0Address = silos[0]?.oracleState?.oracleAddress ?? null
  const oracle1Address = silos[1]?.oracleState?.oracleAddress ?? null

  useEffect(() => {
    setTxError('')
    setTxSuccess(null)
  }, [oracle0Address, oracle1Address])

  useEffect(() => {
    if (eligibility.kind !== 'ok' || !provider || !connectedAccount) {
      setAuthority(null)
      return
    }
    let cancelled = false
    setAuthorityLoading(true)
    void (async () => {
      try {
        const result = await classifyManageableOracleAction(
          provider,
          connectedAccount,
          eligibility.owner,
          eligibility.ownerKind
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
  }, [eligibility, provider, connectedAccount])

  const handleSubmit = useCallback(async () => {
    if (eligibility.kind !== 'ok') return
    if (!provider || !eip1193Provider || !connectedAccount || !revertingOracleAddress) return
    const [a, b] = silos
    if (!a?.oracleState || !b?.oracleState) return
    setBusy(true)
    setTxError('')
    setTxSuccess(null)
    try {
      const signer = await provider.getSigner()
      const result = await executeManageableOracleBatch({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        connectedAccount,
        calls: [
          {
            oracleAddress: a.oracleState.oracleAddress,
            method: 'proposeOracle',
            newOracle: revertingOracleAddress,
          },
          {
            oracleAddress: b.oracleState.oracleAddress,
            method: 'proposeOracle',
            newOracle: revertingOracleAddress,
          },
        ],
        sharedOwner: { address: eligibility.owner, kind: eligibility.ownerKind },
      })
      setTxSuccess(result)
      onActionSuccess()
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [eligibility, provider, eip1193Provider, connectedAccount, revertingOracleAddress, silos, chainId, onActionSuccess])

  /**
   * Hide the row entirely when nothing can be aggregated — the per-silo row 7 buttons handle each
   * silo independently in that case. Owners-differ and pending cases surface a short explanation
   * so the user understands why the bundled option is missing.
   */
  if (eligibility.kind === 'incomplete' || eligibility.kind === 'not_manageable') {
    return null
  }

  if (eligibility.kind === 'owners_differ') {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0 mb-2">Submit for both silos</h2>
        <p className="text-sm silo-alert silo-alert-warning m-0">
          The two solvency oracles have different owners, so we cannot bundle the proposals into a single
          transaction. Use the per-silo buttons above instead.
        </p>
      </section>
    )
  }

  if (eligibility.kind === 'pending_present') {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0 mb-2">Submit for both silos</h2>
        <p className="text-sm silo-alert silo-alert-warning m-0">
          At least one oracle already has a pending update. Resolve or cancel it first — then the bundled
          submit becomes available.
        </p>
      </section>
    )
  }

  if (eligibility.kind === 'no_reverting_oracle') {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0 mb-2">Submit for both silos</h2>
        <p className="text-sm silo-alert silo-alert-warning m-0">
          RevertingOracle is not deployed on this network. Submission is disabled.
        </p>
      </section>
    )
  }

  return (
    <section className="silo-panel p-5 space-y-3">
      <h2 className="text-lg font-semibold silo-text-main m-0">Submit for both silos</h2>
      <p className="text-sm silo-text-soft m-0">
        Both oracles share the same owner
        {eligibility.ownerKind === 'safe' ? ' (Safe multisig)' : ''}. A single{' '}
        {eligibility.ownerKind === 'safe' ? 'Safe proposal' : 'batch of two sequential transactions'} will be
        created with <span className="font-mono silo-text-main">proposeOracle(revertingOracle)</span> for each
        silo.
      </p>

      <button
        type="button"
        className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={busy || authorityLoading || !authority || authority.mode === 'denied'}
        onClick={() => void handleSubmit()}
      >
        {busy ? 'Waiting for wallet…' : 'Propose RevertingOracle for both silos'}
      </button>
      <ActionPermissionHint
        allowed={authority != null && authority.mode !== 'denied'}
        onlyForLabel="oracle owner (directly or as a Safe signer)"
      />
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
    </section>
  )
}
