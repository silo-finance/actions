'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAddress } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import WithdrawQueueRemoveWizard from '@/components/WithdrawQueueRemoveWizard'
import { useWeb3 } from '@/contexts/Web3Context'
import { clearSupplyQueueForOwner, type Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import type { VaultUnderlyingMeta } from '@/utils/vaultReader'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

function normalizeAddressList(markets: ResolvedMarket[]): string[] {
  return markets.map((m) => {
    try {
      return getAddress(m.address)
    } catch {
      return m.address
    }
  })
}

function formatSupplyQueueArgumentJson(addresses: string[]): string {
  return `[${addresses.map((a) => `"${a}"`).join(', ')}]`
}

type Props = {
  chainId: number
  vaultAddress: string
  ownerAddress: string
  ownerKind: OwnerKind
  /** Current supply queue as already loaded in the UI (order preserved). Used to show revert data after a successful clear. */
  supplyQueueMarkets: ResolvedMarket[]
  withdrawQueueMarkets: ResolvedMarket[]
  /** From the last vault Check — same length/order as `withdrawQueueMarkets`. */
  withdrawQueueStates: WithdrawMarketOnchainState[]
  vaultUnderlyingMeta: VaultUnderlyingMeta | null
}

export default function VaultActionsColumn({
  chainId,
  vaultAddress,
  ownerAddress,
  ownerKind,
  supplyQueueMarkets,
  withdrawQueueMarkets,
  withdrawQueueStates,
  vaultUnderlyingMeta,
}: Props) {
  const { provider, account, isConnected } = useWeb3()
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [txSuccess, setTxSuccess] = useState<{
    url: string
    linkLabel: string
    outcome: TxSubmitOutcome
  } | null>(null)
  const [revertSupplyAddresses, setRevertSupplyAddresses] = useState<string[] | null>(null)
  const [activeAction, setActiveAction] = useState<'none' | 'clear' | 'withdraw'>('none')

  useEffect(() => {
    setTxSuccess(null)
    setRevertSupplyAddresses(null)
    setLocalError('')
    setActiveAction('none')
  }, [vaultAddress, ownerAddress, ownerKind, chainId])

  const canAttempt =
    isConnected &&
    provider != null &&
    typeof window !== 'undefined' &&
    window.ethereum != null &&
    (ownerKind === 'eoa' || ownerKind === 'safe')

  const handleClearSupplyQueue = useCallback(async () => {
    setLocalError('')
    setTxSuccess(null)
    setRevertSupplyAddresses(null)
    if (!provider || !account || !window.ethereum) {
      setLocalError('Wallet not available.')
      return
    }
    const snapshot = normalizeAddressList(supplyQueueMarkets)
    setBusy(true)
    try {
      const signer = await provider.getSigner()
      const { transactionUrl, successLinkLabel: label, outcome } = await clearSupplyQueueForOwner({
        ethereum: window.ethereum as Eip1193Provider,
        provider,
        signer,
        chainId,
        vaultAddress,
        ownerAddress,
        ownerKind,
        connectedAccount: account,
      })
      setTxSuccess({ url: transactionUrl, linkLabel: label, outcome })
      setRevertSupplyAddresses(snapshot)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLocalError(msg || 'Transaction failed.')
    } finally {
      setBusy(false)
    }
  }, [
    provider,
    account,
    chainId,
    vaultAddress,
    ownerAddress,
    ownerKind,
    supplyQueueMarkets,
  ])

  const revertArgumentText =
    revertSupplyAddresses != null ? formatSupplyQueueArgumentJson(revertSupplyAddresses) : null

  if (activeAction === 'withdraw') {
    return (
      <WithdrawQueueRemoveWizard
        chainId={chainId}
        vaultAddress={vaultAddress}
        ownerAddress={ownerAddress}
        ownerKind={ownerKind}
        supplyQueueMarkets={supplyQueueMarkets}
        withdrawMarkets={withdrawQueueMarkets}
        withdrawMarketStates={withdrawQueueStates}
        underlyingMeta={vaultUnderlyingMeta}
        onCancel={() => setActiveAction('none')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {activeAction === 'none' ? (
        <>
          <button
            type="button"
            disabled={!canAttempt || busy}
            onClick={() => setActiveAction('clear')}
            className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear supply queue
          </button>
          <button
            type="button"
            disabled={withdrawQueueMarkets.length === 0}
            onClick={() => setActiveAction('withdraw')}
            className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reallocate & remove from withdraw queue
          </button>
        </>
      ) : null}

      {activeAction === 'clear' ? (
        <div className="silo-choice-option" data-selected="true">
          <div className="w-full space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold silo-text-main">Clear supply queue</p>
              <button
                type="button"
                onClick={() => {
                  setActiveAction('none')
                  setLocalError('')
                  setTxSuccess(null)
                  setRevertSupplyAddresses(null)
                }}
                className="text-xs font-medium silo-text-soft hover:silo-text-main underline"
              >
                Back
              </button>
            </div>

            <button
              type="button"
              disabled={!canAttempt || busy}
              onClick={() => void handleClearSupplyQueue()}
              className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Waiting for wallet…' : 'Execute clear supply queue'}
            </button>

            {localError ? <p className="text-sm silo-alert silo-alert-error">{localError}</p> : null}
            {txSuccess ? (
              <div className="flex flex-col gap-3 pt-1">
                <TransactionSuccessSummary
                  url={txSuccess.url}
                  linkLabel={txSuccess.linkLabel}
                  outcome={txSuccess.outcome}
                />
                {revertArgumentText != null ? (
                  <div className="silo-choice-option" data-selected="true">
                    <div className="w-full space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft">Inject revert changes</p>
                      <p className="text-sm silo-text-main">
                        Method: <code className="text-xs font-mono silo-text-main">setSupplyQueue</code>
                      </p>
                      <p className="text-sm silo-text-main">
                        Argument <code className="text-xs font-mono silo-text-main">_newSupplyQueue</code>:
                      </p>
                      <div className="flex flex-wrap items-start gap-2">
                        <pre className="text-xs font-mono silo-text-main whitespace-pre-wrap break-all flex-1 min-w-0 m-0">
                          {revertArgumentText}
                        </pre>
                        <CopyButton value={revertArgumentText} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
