'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import CopyButton from '@/components/CopyButton'
import QueueColumn, { type QueueRowSelection } from '@/components/QueueColumn'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import { useVaultPermissions } from '@/contexts/VaultPermissionsContext'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import {
  buildSubmitMarketRemovalPreview,
  classifyMarketRemoval,
  describeMarketRemovalDisabledReasons,
  executeSubmitMarketRemoval,
  type SelectedMarketForRemoval,
} from '@/utils/submitMarketRemovalBatch'
import { ONLY_FOR_OWNER_OR_CURATOR } from '@/utils/vaultActionRoleCopy'
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

/**
 * Withdraw Queue panel with selection checkboxes and a Submit Market Removal action at the bottom.
 * The action only becomes available once the user selects at least one eligible market.
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
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [execErr, setExecErr] = useState('')
  const [txSuccess, setTxSuccess] = useState<{
    url: string
    linkLabel: string
    outcome: TxSubmitOutcome
  } | null>(null)

  useEffect(() => {
    setSelected(new Set())
    setExecErr('')
    setTxSuccess(null)
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
  const mutationAllowed: boolean | null =
    !hasLoaded || !vaultAddress
      ? null
      : !isConnected || !account
        ? false
        : perm.loading || perm.classificationError != null
          ? null
          : perm.canOwnerOrCurator

  /**
   * `direct` = connected EOA acts as owner/curator straight on the vault; one tx per wallet prompt.
   * We force single-select here because SiloVault does not expose a generic batch entry point
   * for EOA writes — chaining multiple submitCap/submitMarketRemoval would be N wallet prompts.
   */
  const singleOnly = ownerCuratorAuth?.mode === 'direct'

  const rowForIndex = useCallback(
    (index: number): {
      disabled: boolean
      reason?: string
      inlineReason?: string
      inlineWarning?: string
    } => {
      // On-chain blocker check first so the row always explains the real cause even when the
      // wallet is not yet allowed to submit.
      const state = queueStates[index]
      const mode = classifyMarketRemoval(state, chainNowSec)
      if (!hasLoaded) return { disabled: true, reason: 'Run Check first.' }
      if (!statesAligned) {
        return { disabled: true, reason: 'Withdraw queue state is out of sync. Run Check again.' }
      }
      if (mode.kind === 'ineligible') {
        const reason = describeMarketRemovalDisabledReasons(state, chainNowSec) ?? undefined
        return { disabled: true, reason, inlineReason: reason }
      }
      if (mutationAllowed === false) {
        return {
          disabled: true,
          reason: 'Only the vault owner or curator can submit market removals.',
        }
      }
      if (mutationAllowed == null) {
        return { disabled: true, reason: 'Checking permissions…' }
      }
      if (singleOnly && selected.size > 0 && !selected.has(index)) {
        return {
          disabled: true,
          reason: 'Connected EOA can only submit one removal at a time. Clear the current selection to pick another market.',
        }
      }
      if (mode.kind === 'finalize') {
        // Once the forced-removal timelock is up, checking the box turns the action into an
        // instant `updateWithdrawQueue` call — warn the user inline in yellow.
        if (selected.has(index)) {
          return { disabled: false, inlineWarning: 'It will be removed instantly.' }
        }
        return { disabled: false, inlineReason: 'Removable now.' }
      }
      return { disabled: false }
    },
    [hasLoaded, statesAligned, mutationAllowed, queueStates, selected, singleOnly, chainNowSec]
  )

  const handleToggle = useCallback(
    (index: number) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(index)) {
          next.delete(index)
          return next
        }
        if (singleOnly) {
          return new Set([index])
        }
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
        ariaLabel: 'Select market for removal',
      }
    : undefined

  const selectedMarkets = useMemo<SelectedMarketForRemoval[]>(() => {
    if (!statesAligned) return []
    const out: SelectedMarketForRemoval[] = []
    for (let i = 0; i < items.length; i++) {
      if (!selected.has(i)) continue
      const st = queueStates[i]!
      const mode = classifyMarketRemoval(st, chainNowSec)
      if (mode.kind === 'ineligible') continue
      out.push({ address: st.address, cap: st.cap, mode: mode.kind })
    }
    return out
  }, [statesAligned, items, queueStates, selected, chainNowSec])

  const withdrawQueueAddresses = useMemo(
    () => items.map((m) => m.address),
    [items]
  )

  const preview = useMemo(
    () =>
      buildSubmitMarketRemovalPreview({
        withdrawQueue: withdrawQueueAddresses,
        selected: selectedMarkets,
      }),
    [withdrawQueueAddresses, selectedMarkets]
  )

  const hasSubmitMode = selectedMarkets.some((m) => m.mode === 'submit')
  const hasFinalizeMode = selectedMarkets.some((m) => m.mode === 'finalize')

  const canExecute =
    walletReady &&
    account != null &&
    mutationAllowed === true &&
    selectedMarkets.length > 0 &&
    !busy

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
      const { transactionUrl, successLinkLabel, outcome } = await executeSubmitMarketRemoval({
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
      setTxSuccess({ url: transactionUrl, linkLabel: successLinkLabel, outcome })
      setSelected(new Set())
    } catch (e) {
      setExecErr(toUserErrorMessage(e))
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
  ])

  const buttonLabel = hasSubmitMode
    ? 'Submit Market Removal'
    : hasFinalizeMode
      ? 'Remove Market'
      : 'Submit Market Removal'

  const actionDescription = hasSubmitMode
    ? hasFinalizeMode
      ? 'Submits the forced-removal timelock for markets still under cap and drops the ones whose timelock has already elapsed from the withdraw queue.'
      : 'Starts the forced-removal timelock for each selected market (adds submitCap(market, 0) first when the current cap is non-zero).'
    : 'Drops the selected markets from the withdraw queue in a single updateWithdrawQueue call.'

  const footer = hasLoaded && items.length > 0 ? (
    <div className="space-y-2 border-t border-[var(--silo-border)] pt-4">
      <button
        type="button"
        disabled={!canExecute}
        onClick={() => void handleExecute()}
        className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Waiting for wallet…' : buttonLabel}
      </button>
      <p className="m-0 text-sm silo-text-main">{actionDescription}</p>
      <ActionPermissionHint
        allowed={mutationAllowed !== false}
        onlyForLabel={ONLY_FOR_OWNER_OR_CURATOR}
      />
      {singleOnly && mutationAllowed === true ? (
        <p className="m-0 text-xs silo-text-soft">
          Your wallet is an EOA — only one market per transaction. Connect as a Safe signer (or with the Safe as the wallet) to batch multiple removals.
        </p>
      ) : null}
      {preview.length > 0 ? (
        <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
          <p className="text-sm font-medium silo-text-main">Planned calls</p>
          <ol className="list-decimal list-outside space-y-4 text-sm silo-text-main m-0 pl-5 sm:pl-6">
            {preview.map((s) => (
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
      ) : null}
      {execErr ? <p className="text-sm silo-alert silo-alert-error">{execErr}</p> : null}
      {txSuccess ? (
        <TransactionSuccessSummary
          url={txSuccess.url}
          linkLabel={txSuccess.linkLabel}
          outcome={txSuccess.outcome}
        />
      ) : null}
    </div>
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
      footer={footer}
    />
  )
}
