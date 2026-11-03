'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import VaultActionFailure from '@/components/VaultActionFailure'
import CopyButton from '@/components/CopyButton'
import QueueColumn, { type QueueRowSelection } from '@/components/QueueColumn'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import { useVaultPermissions } from '@/contexts/VaultPermissionsContext'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import {
  FINALIZE_REMOVAL_ELAPSED_HINT,
  SUBMIT_MARKET_REMOVAL_SECOND_STEP,
  UPDATE_WITHDRAW_QUEUE_READY_EMPTY,
  UPDATE_WITHDRAW_QUEUE_READY_WITH_SUPPLY,
  buildSubmitMarketRemovalPreview,
  classifyMarketRemoval,
  classifyUpdateWithdrawQueueRemoval,
  describeMarketRemovalDisabledReasons,
  describeUpdateWithdrawQueueFailure,
  describeUpdateWithdrawQueueRemoval,
  executeSubmitMarketRemoval,
  executeUpdateWithdrawQueueRemoval,
  type PlannedRemovalStep,
  type SelectedMarketForRemoval,
} from '@/utils/submitMarketRemovalBatch'
import { ONLY_FOR_ALLOCATOR_ACTIONS, ONLY_FOR_OWNER_OR_CURATOR } from '@/utils/vaultActionRoleCopy'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

type Props = {
  title: string
  count?: number
  chainId: number
  items: ResolvedMarket[]
  queueStates: WithdrawMarketOnchainState[]
  loading?: boolean
  emptyMessage?: string
  hasLoaded: boolean
  vaultAddress: string
  ownerAddress: string
  curatorAddress: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
}

type Procedure = 'submit' | 'finalize'

type TxSuccess = {
  url: string
  linkLabel: string
  outcome: TxSubmitOutcome
  procedure: Procedure
}

/**
 * Withdraw Queue panel. Submit Market Removal starts the forced-removal timelock.
 * Finalize pending removals, above the list, scans for markets whose timelock has elapsed
 * and drops them with `updateWithdrawQueue`.
 */
export default function SubmitMarketRemovalSection({
  title,
  count,
  chainId,
  items,
  queueStates,
  loading,
  emptyMessage,
  hasLoaded,
  vaultAddress,
  ownerAddress,
  curatorAddress,
  ownerKind,
  curatorKind,
}: Props) {
  const { provider, eip1193Provider, account, isConnected } = useWeb3()
  const perm = useVaultPermissions()
  const [procedure, setProcedure] = useState<Procedure>('submit')
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [execErr, setExecErr] = useState('')
  const [txSuccess, setTxSuccess] = useState<TxSuccess | null>(null)
  const finalizeScanPending = useRef(false)

  useEffect(() => {
    setProcedure('submit')
    setSelected(new Set())
    setExecErr('')
    setTxSuccess(null)
    finalizeScanPending.current = false
  }, [vaultAddress, items])

  /**
   * Block timestamp used for the `Removable in …` countdown on rows with `removableAt != 0`.
   * We refresh after new `queueStates` arrive and every 30s while the panel is mounted so the
   * duration stays roughly in sync with the chain without hammering the RPC.
   */
  const [chainNowSec, setChainNowSec] = useState<bigint | null>(null)
  useEffect(() => {
    if (!provider || !hasLoaded) {
      setChainNowSec(null)
      return
    }
    let cancelled = false
    const refresh = () => {
      void provider.getBlock('latest').then((b) => {
        if (!cancelled && b != null) setChainNowSec(BigInt(b.timestamp))
      })
    }
    refresh()
    const id = window.setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [provider, hasLoaded, queueStates])

  const statesAligned = queueStates.length === items.length
  const walletReady = isConnected && provider != null && eip1193Provider != null

  const ownerCuratorAuth = perm.ownerCuratorAuth
  const submitAllowed: boolean | null =
    !hasLoaded || !vaultAddress
      ? null
      : !isConnected || !account
        ? false
        : perm.loading || perm.classificationError != null
          ? null
          : perm.canOwnerOrCurator
  const finalizeAllowed: boolean | null =
    !hasLoaded || !vaultAddress
      ? null
      : !isConnected || !account
        ? false
        : perm.loading || perm.classificationError != null
          ? null
          : perm.canAllocator

  /**
   * `direct` = connected EOA acts as owner/curator straight on the vault; one tx per wallet prompt.
   * We force single-select here because SiloVault does not expose a generic batch entry point
   * for EOA writes — chaining multiple submitCap/submitMarketRemoval would be N wallet prompts.
   * `updateWithdrawQueue` is one call for every selected market, so finalize stays multi-select.
   */
  const singleOnly = procedure === 'submit' && ownerCuratorAuth?.mode === 'direct'

  useEffect(() => {
    if (procedure !== 'finalize' || !finalizeScanPending.current || !statesAligned) return
    const needsClock = queueStates.some((state) => state.removableAt !== BigInt(0))
    if (needsClock && chainNowSec == null) return
    const next = new Set<number>()
    queueStates.forEach((state, index) => {
      if (classifyUpdateWithdrawQueueRemoval(state, chainNowSec).kind === 'ready') next.add(index)
    })
    setSelected(next)
    finalizeScanPending.current = false
  }, [procedure, statesAligned, chainNowSec, queueStates])

  const rowForIndex = useCallback(
    (index: number): {
      disabled: boolean
      reason?: string
      inlineReason?: string
      inlineWarning?: string
    } => {
      const state = queueStates[index]
      if (!hasLoaded) return { disabled: true, reason: 'Run Check first.' }
      if (!statesAligned) {
        return { disabled: true, reason: 'Withdraw queue state is out of sync. Run Check again.' }
      }
      if (procedure === 'finalize') {
        const mode = classifyUpdateWithdrawQueueRemoval(state, chainNowSec)
        if (mode.kind === 'blocked') {
          const reason = describeUpdateWithdrawQueueRemoval(state, chainNowSec) ?? 'This market cannot be removed.'
          return { disabled: true, reason, inlineReason: reason }
        }
        if (mode.hasSupply) {
          return { disabled: false, inlineWarning: UPDATE_WITHDRAW_QUEUE_READY_WITH_SUPPLY }
        }
        return { disabled: false, inlineReason: UPDATE_WITHDRAW_QUEUE_READY_EMPTY }
      }

      const mode = classifyMarketRemoval(state, chainNowSec)
      if (mode.kind === 'finalize') {
        return {
          disabled: true,
          reason: FINALIZE_REMOVAL_ELAPSED_HINT,
          inlineReason: FINALIZE_REMOVAL_ELAPSED_HINT,
        }
      }
      if (mode.kind === 'ineligible') {
        const reason = describeMarketRemovalDisabledReasons(state, chainNowSec) ?? undefined
        return { disabled: true, reason, inlineReason: reason }
      }
      if (submitAllowed === false) {
        return {
          disabled: true,
          reason: 'Only the vault owner or curator can submit market removals.',
        }
      }
      if (submitAllowed == null) {
        return { disabled: true, reason: 'Checking permissions…' }
      }
      if (singleOnly && selected.size > 0 && !selected.has(index)) {
        return {
          disabled: true,
          reason: 'Connected EOA can only submit one removal at a time. Clear the current selection to pick another market.',
        }
      }
      return { disabled: false }
    },
    [hasLoaded, statesAligned, procedure, submitAllowed, queueStates, selected, singleOnly, chainNowSec]
  )

  const handleToggle = useCallback(
    (index: number) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(index)) {
          next.delete(index)
          return next
        }
        if (singleOnly) return new Set([index])
        next.add(index)
        return next
      })
      setExecErr('')
      setTxSuccess(null)
    },
    [singleOnly]
  )

  const selectionProp: QueueRowSelection | undefined = hasLoaded
    ? {
        selected,
        onToggle: handleToggle,
        rowState: rowForIndex,
        ariaLabel:
          procedure === 'finalize' ? 'Select market for updateWithdrawQueue' : 'Select market for removal',
      }
    : undefined

  const selectedMarkets = useMemo<SelectedMarketForRemoval[]>(() => {
    if (!statesAligned) return []
    const out: SelectedMarketForRemoval[] = []
    for (let i = 0; i < items.length; i++) {
      if (!selected.has(i)) continue
      const st = queueStates[i]!
      if (procedure === 'finalize') {
        if (classifyUpdateWithdrawQueueRemoval(st, chainNowSec).kind !== 'ready') continue
        out.push({ address: st.address, cap: st.cap, mode: 'finalize' })
        continue
      }
      if (classifyMarketRemoval(st, chainNowSec).kind !== 'submit') continue
      out.push({ address: st.address, cap: st.cap, mode: 'submit' })
    }
    return out
  }, [statesAligned, items, queueStates, selected, chainNowSec, procedure])

  const withdrawQueueAddresses = useMemo(() => items.map((m) => m.address), [items])

  const preview = useMemo(
    () =>
      buildSubmitMarketRemovalPreview({
        withdrawQueue: withdrawQueueAddresses,
        selected: selectedMarkets,
      }),
    [withdrawQueueAddresses, selectedMarkets]
  )

  const activeAllowed = procedure === 'finalize' ? finalizeAllowed : submitAllowed
  const canExecute =
    walletReady && account != null && activeAllowed === true && selectedMarkets.length > 0 && !busy

  const startFinalize = useCallback(() => {
    setProcedure('finalize')
    setSelected(new Set())
    setExecErr('')
    setTxSuccess(null)
    finalizeScanPending.current = true
  }, [])

  const cancelFinalize = useCallback(() => {
    setProcedure('submit')
    setSelected(new Set())
    setExecErr('')
    setTxSuccess(null)
    finalizeScanPending.current = false
  }, [])

  const handleExecute = useCallback(async () => {
    setExecErr('')
    setTxSuccess(null)
    if (!provider || !account || !eip1193Provider) {
      setExecErr('Wallet not available.')
      return
    }
    if (selectedMarkets.length === 0) {
      setExecErr('Select at least one market to remove.')
      return
    }
    setBusy(true)
    try {
      const signer = await provider.getSigner()
      const run = procedure === 'finalize' ? executeUpdateWithdrawQueueRemoval : executeSubmitMarketRemoval
      const { transactionUrl, successLinkLabel, outcome } = await run({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        vaultAddress,
        ownerAddress,
        curatorAddress,
        ownerKind,
        curatorKind,
        connectedAccount: account,
        withdrawQueue: withdrawQueueAddresses,
        markets: selectedMarkets,
      })
      setTxSuccess({ url: transactionUrl, linkLabel: successLinkLabel, outcome, procedure })
      setSelected(new Set())
      if (procedure === 'finalize') finalizeScanPending.current = false
    } catch (e) {
      setExecErr(procedure === 'finalize' ? describeUpdateWithdrawQueueFailure(e) : toUserErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }, [
    provider,
    eip1193Provider,
    account,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    curatorKind,
    withdrawQueueAddresses,
    selectedMarkets,
    procedure,
  ])

  const leading =
    hasLoaded && items.length > 0 ? (
      procedure === 'finalize' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm font-medium silo-text-main">Markets checked for updateWithdrawQueue</p>
            <button
              type="button"
              onClick={cancelFinalize}
              className="text-xs font-medium silo-text-soft hover:silo-text-main underline"
            >
              Cancel
            </button>
          </div>
          <p className="m-0 text-xs silo-text-soft leading-snug">
            Selected markets will be removed. Markets that cannot be removed stay disabled.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={startFinalize} className="silo-btn-secondary">
            Finalize pending removals
          </button>
          <p className="m-0 text-xs silo-text-soft leading-snug">
            Second step after the submitMarketRemoval timelock. Scans this queue and removes markets whose
            timelock has elapsed by calling updateWithdrawQueue.
          </p>
        </div>
      )
    ) : null

  const footer =
    hasLoaded && items.length > 0 ? (
      procedure === 'finalize' ? (
        <FinalizeFooter
          selectedCount={selectedMarkets.length}
          busy={busy}
          canExecute={canExecute}
          allowed={finalizeAllowed}
          preview={preview}
          execErr={execErr}
          txSuccess={txSuccess}
          onExecute={() => void handleExecute()}
        />
      ) : (
        <div className="space-y-2 border-t border-[var(--silo-border)] pt-4">
          <button
            type="button"
            disabled={!canExecute}
            onClick={() => void handleExecute()}
            className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Waiting for wallet…' : 'Submit Market Removal'}
          </button>
          <p className="m-0 text-sm silo-text-main">
            Starts the forced-removal timelock for each selected market (adds submitCap(market, 0) first when the
            current cap is non-zero). {SUBMIT_MARKET_REMOVAL_SECOND_STEP}
          </p>
          <ActionPermissionHint allowed={submitAllowed !== false} onlyForLabel={ONLY_FOR_OWNER_OR_CURATOR} />
          {singleOnly && submitAllowed === true ? (
            <p className="m-0 text-xs silo-text-soft">
              Your wallet is an EOA — only one market per transaction. Connect as a Safe signer (or with the Safe as
              the wallet) to batch multiple removals.
            </p>
          ) : null}
          <PlannedCalls steps={preview} />
          <VaultActionFailure message={execErr} />
          {txSuccess?.procedure === 'submit' ? (
            <div className="space-y-2">
              <TransactionSuccessSummary
                url={txSuccess.url}
                linkLabel={txSuccess.linkLabel}
                outcome={txSuccess.outcome}
              />
              <p className="m-0 text-sm silo-text-main">{SUBMIT_MARKET_REMOVAL_SECOND_STEP}</p>
            </div>
          ) : null}
        </div>
      )
    ) : null

  return (
    <QueueColumn
      title={title}
      count={count}
      chainId={chainId}
      items={items}
      queueStates={queueStates}
      loading={loading}
      emptyMessage={emptyMessage}
      selection={selectionProp}
      leading={leading}
      footer={footer}
    />
  )
}

function removalSummary(count: number): string {
  if (count === 0) return 'No markets are selected for removal.'
  if (count === 1) return '1 selected market will be removed from the withdraw queue.'
  return `${count} selected markets will be removed from the withdraw queue.`
}

function FinalizeFooter({
  selectedCount,
  busy,
  canExecute,
  allowed,
  preview,
  execErr,
  txSuccess,
  onExecute,
}: {
  selectedCount: number
  busy: boolean
  canExecute: boolean
  allowed: boolean | null
  preview: PlannedRemovalStep[]
  execErr: string
  txSuccess: TxSuccess | null
  onExecute: () => void
}) {
  return (
    <div className="space-y-2 border-t border-[var(--silo-border)] pt-4">
      <p className="m-0 text-sm silo-text-main">{removalSummary(selectedCount)}</p>
      <button
        type="button"
        disabled={!canExecute}
        onClick={onExecute}
        className="silo-btn-primary w-full justify-center font-mono disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Waiting for wallet…' : 'updateWithdrawQueue'}
      </button>
      <ActionPermissionHint allowed={allowed !== false} onlyForLabel={ONLY_FOR_ALLOCATOR_ACTIONS} />
      <PlannedCalls steps={preview} />
      <VaultActionFailure message={execErr} />
      {txSuccess?.procedure === 'finalize' ? (
        <TransactionSuccessSummary
          url={txSuccess.url}
          linkLabel={txSuccess.linkLabel}
          outcome={txSuccess.outcome}
        />
      ) : null}
    </div>
  )
}

function PlannedCalls({ steps }: { steps: PlannedRemovalStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
      <p className="text-sm font-medium silo-text-main">Planned calls</p>
      <ol className="list-decimal list-outside space-y-4 text-sm silo-text-main m-0 pl-5 sm:pl-6">
        {steps.map((s) => (
          <li key={s.id} className="min-w-0 pl-1 space-y-1.5">
            <p className="text-sm silo-text-main m-0 leading-snug">
              <code className="text-xs font-mono silo-text-main">{s.method}</code>
              <span className="silo-text-soft"> · </span>
              <span className="text-xs silo-text-soft">{s.argLabel}</span>
            </p>
            <div className="flex flex-wrap items-start gap-2 min-w-0">
              <pre className="text-xs font-mono silo-text-main whitespace-pre-wrap break-all flex-1 min-w-0 m-0">
                {s.copyValue}
              </pre>
              <CopyButton value={s.copyValue} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
