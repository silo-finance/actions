'use client'

import { useCallback, useEffect, useState } from 'react'
import { getAddress } from 'ethers'
import CopyButton from '@/components/CopyButton'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import { useWeb3 } from '@/contexts/Web3Context'
import { clearSupplyQueueForOwner, type Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'

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
}

export default function VaultActionsColumn({
  chainId,
  vaultAddress,
  ownerAddress,
  ownerKind,
  supplyQueueMarkets,
}: Props) {
  const { provider, account, isConnected } = useWeb3()
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [successTransactionUrl, setSuccessTransactionUrl] = useState<string | null>(null)
  const [successLinkLabel, setSuccessLinkLabel] = useState<string>('Open queue')
  const [revertSupplyAddresses, setRevertSupplyAddresses] = useState<string[] | null>(null)

  useEffect(() => {
    setSuccessTransactionUrl(null)
    setSuccessLinkLabel('Open queue')
    setRevertSupplyAddresses(null)
    setLocalError('')
  }, [vaultAddress, ownerAddress, ownerKind, chainId])

  const canAttempt =
    isConnected &&
    provider != null &&
    typeof window !== 'undefined' &&
    window.ethereum != null &&
    (ownerKind === 'eoa' || ownerKind === 'safe')

  const handleClearSupplyQueue = useCallback(async () => {
    setLocalError('')
    setSuccessTransactionUrl(null)
    setSuccessLinkLabel('Open queue')
    setRevertSupplyAddresses(null)
    if (!provider || !account || !window.ethereum) {
      setLocalError('Wallet not available.')
      return
    }
    const snapshot = normalizeAddressList(supplyQueueMarkets)
    setBusy(true)
    try {
      const signer = await provider.getSigner()
      const { transactionUrl, successLinkLabel: label } = await clearSupplyQueueForOwner({
        ethereum: window.ethereum as Eip1193Provider,
        provider,
        signer,
        chainId,
        vaultAddress,
        ownerAddress,
        ownerKind,
        connectedAccount: account,
      })
      setSuccessTransactionUrl(transactionUrl)
      setSuccessLinkLabel(label)
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

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        disabled={!canAttempt || busy}
        onClick={() => void handleClearSupplyQueue()}
        className="silo-btn-primary text-left justify-center disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Waiting for wallet…' : 'Clear supply queue'}
      </button>
      {localError ? <p className="text-sm silo-alert silo-alert-error">{localError}</p> : null}
      {successTransactionUrl ? (
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={successTransactionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium silo-text-main hover:underline break-all min-w-0"
            >
              {successLinkLabel}
            </a>
            <ShareLinkCopyButton url={successTransactionUrl} />
          </div>
          {revertArgumentText != null ? (
            <div className="rounded-md border border-[var(--silo-border)] bg-[var(--silo-surface-2)] p-3 space-y-2">
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
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
