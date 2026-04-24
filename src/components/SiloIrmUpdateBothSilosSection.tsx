'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress, type BrowserProvider } from 'ethers'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import {
  DYNAMIC_KINK_IRM_DENIED_MESSAGE,
  executeDynamicKinkIrmBatch,
  type DynamicKinkIrmCall,
  type DynamicKinkIrmActionSuccess,
} from '@/utils/dynamicKinkIrmAction'
import { classifyManageableOracleAction, type ManageableOracleAuthority } from '@/utils/manageableOracleAction'
import { sameDynamicKinkIrmConfig, type DynamicKinkIrmConfig } from '@/utils/dynamicKinkIrmConfig'
import type { DynamicKinkIrmReadState } from '@/utils/dynamicKinkIrmReader'
import type { OwnerKind } from '@/utils/ownerKind'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'

type SiloIrmEntry = {
  silo: string
  interestRateModel: string
  irm: DynamicKinkIrmReadState | null
  ownerKind: OwnerKind | null
}

type Props = {
  chainId: number
  silos: readonly [SiloIrmEntry, SiloIrmEntry]
  configBySilo: Record<string, DynamicKinkIrmConfig | null>
  provider: BrowserProvider | null
  eip1193Provider: Eip1193Provider | null
  connectedAccount: string
  onActionSuccess: () => void
}

type Eligibility =
  | { kind: 'ok'; owner: string; ownerKind: OwnerKind }
  | { kind: 'not_dkm' }
  | { kind: 'pending' }
  | { kind: 'owners_differ' }
  | { kind: 'incomplete' }
  | { kind: 'config_incomplete' }
  | { kind: 'same_irm_mismatch' }

function computeEligibility(
  [a, b]: readonly [SiloIrmEntry, SiloIrmEntry],
  configBySilo: Record<string, DynamicKinkIrmConfig | null>
): Eligibility {
  if (!a.irm || !b.irm || !a.ownerKind || !b.ownerKind) return { kind: 'incomplete' }
  if (!a.irm.isDynamicKinkModel || !b.irm.isDynamicKinkModel) return { kind: 'not_dkm' }
  if (a.irm.pendingConfigExists || b.irm.pendingConfigExists) return { kind: 'pending' }
  if (!a.irm.owner || !b.irm.owner) return { kind: 'incomplete' }
  if (a.irm.owner.toLowerCase() !== b.irm.owner.toLowerCase()) return { kind: 'owners_differ' }
  if (a.ownerKind !== b.ownerKind) return { kind: 'owners_differ' }
  const ca = configBySilo[a.silo.toLowerCase()] ?? null
  const cb = configBySilo[b.silo.toLowerCase()] ?? null
  if (!ca || !cb) return { kind: 'config_incomplete' }
  if (a.interestRateModel.toLowerCase() === b.interestRateModel.toLowerCase() && !sameDynamicKinkIrmConfig(ca, cb)) {
    return { kind: 'same_irm_mismatch' }
  }
  return { kind: 'ok', owner: a.irm.owner, ownerKind: a.ownerKind }
}

function buildCalls(
  [a, b]: readonly [SiloIrmEntry, SiloIrmEntry],
  configBySilo: Record<string, DynamicKinkIrmConfig | null>
): DynamicKinkIrmCall[] {
  const map = new Map<string, DynamicKinkIrmConfig>()
  for (const e of [a, b]) {
    const cfg = configBySilo[e.silo.toLowerCase()]!
    const irm = getAddress(e.interestRateModel).toLowerCase()
    const prev = map.get(irm)
    if (prev) {
      if (sameDynamicKinkIrmConfig(prev, cfg)) continue
      throw new Error('These silos use the same IRM contract with different selected configs.')
    }
    map.set(irm, cfg)
  }
  return Array.from(map.entries()).map(([irmKey, config]) => ({
    irmAddress: getAddress(irmKey),
    config,
  }))
}

export default function SiloIrmUpdateBothSilosSection({
  chainId,
  silos,
  configBySilo,
  provider,
  eip1193Provider,
  connectedAccount,
  onActionSuccess,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [txError, setTxError] = useState('')
  const [txSuccess, setTxSuccess] = useState<DynamicKinkIrmActionSuccess | null>(null)
  const [authority, setAuthority] = useState<ManageableOracleAuthority | null>(null)
  const [authorityLoading, setAuthorityLoading] = useState(false)

  const eligibility = useMemo(
    () => computeEligibility(silos, configBySilo),
    [silos, configBySilo]
  )

  const callCount = useMemo(() => {
    if (eligibility.kind !== 'ok') return 0
    try {
      return buildCalls(silos, configBySilo).length
    } catch {
      return 0
    }
  }, [eligibility, silos, configBySilo])

  useEffect(() => {
    if (eligibility.kind !== 'ok' || !provider || !connectedAccount) {
      setAuthority(null)
      return
    }
    let cancelled = false
    setAuthorityLoading(true)
    void (async () => {
      try {
        const r = await classifyManageableOracleAction(
          provider,
          connectedAccount,
          eligibility.owner,
          eligibility.ownerKind
        )
        if (!cancelled) setAuthority(r)
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

  const handleBatch = useCallback(async () => {
    if (eligibility.kind !== 'ok') return
    if (!provider || !eip1193Provider || !connectedAccount) return
    if (authority == null || authority.mode === 'denied') return
    setBusy(true)
    setTxError('')
    setTxSuccess(null)
    try {
      const calls = buildCalls(silos, configBySilo)
      const signer = await provider.getSigner()
      const result = await executeDynamicKinkIrmBatch({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        connectedAccount,
        calls,
        sharedOwner: { address: eligibility.owner, kind: eligibility.ownerKind },
      })
      setTxSuccess(result)
      onActionSuccess()
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [eligibility, provider, eip1193Provider, connectedAccount, authority, silos, configBySilo, chainId, onActionSuccess])

  if (eligibility.kind === 'incomplete') {
    return null
  }
  if (eligibility.kind === 'not_dkm') {
    return (
      <div className="silo-panel p-4 text-sm silo-text-soft">
        Batched IRM update is only shown when both silos use a DynamicKinkModel.
      </div>
    )
  }
  if (eligibility.kind === 'owners_differ') {
    return (
      <div className="silo-panel p-4 text-sm silo-text-soft">
        IRM contract owners differ between silos — use per-silo submit buttons instead.
      </div>
    )
  }
  if (eligibility.kind === 'pending') {
    return (
      <div className="silo-panel p-4 text-sm silo-alert silo-alert-warning m-0">
        One of the IRMs has a pending config — resolve it before a batched update.
      </div>
    )
  }
  if (eligibility.kind === 'config_incomplete') {
    return (
      <div className="silo-panel p-4 text-sm silo-text-soft">
        Select a full config (preset or flat) for each silo before a batched update.
      </div>
    )
  }
  if (eligibility.kind === 'same_irm_mismatch') {
    return (
      <div className="silo-panel p-4 text-sm silo-alert silo-alert-error m-0">
        Both silos use the same IRM address — the selected config must be identical, or use a single silo&rsquo;s
        update button.
      </div>
    )
  }

  const can =
    (authority?.mode === 'direct' || authority?.mode === 'safe_as_wallet' || authority?.mode === 'safe_propose') &&
    !authorityLoading

  return (
    <div className="silo-panel p-5 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">Both ticked</p>
      <p className="text-sm silo-text-main m-0">
        Same IRM owner on both — one transaction with {callCount} on-chain
        {callCount === 1 ? ' call' : ' calls'}.
      </p>
      {txError ? <p className="text-sm silo-alert silo-alert-error m-0">{txError}</p> : null}
      {txSuccess ? (
        <TransactionSuccessSummary
          url={txSuccess.transactionUrl}
          linkLabel={txSuccess.successLinkLabel}
          outcome={txSuccess.outcome}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="silo-btn-primary w-full"
          disabled={!can || busy}
          onClick={() => void handleBatch()}
        >
          {busy ? 'Submitting…' : 'Update IRM (both)'}
        </button>
        <ActionPermissionHint
          allowed={authority != null && authority.mode !== 'denied'}
          onlyForLabel="shared IRM owner (directly or as a Safe signer)"
        />
        {authority?.mode === 'denied' && !authorityLoading ? (
          <p className="text-xs silo-alert silo-alert-error m-0">{DYNAMIC_KINK_IRM_DENIED_MESSAGE}</p>
        ) : null}
      </div>
    </div>
  )
}
