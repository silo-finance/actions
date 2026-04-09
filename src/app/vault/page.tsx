'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import QueueColumn from '@/components/QueueColumn'
import SupplyQueueColumn from '@/components/SupplyQueueColumn'
import VaultActionsColumn from '@/components/VaultActionsColumn'
import VaultSummaryPanel from '@/components/VaultSummaryPanel'
import { useWeb3 } from '@/contexts/Web3Context'
import { extractHexAddressLike } from '@/utils/addressFromInput'
import { normalizeAddress } from '@/utils/addressValidation'
import { classifyVaultInput } from '@/utils/explorerInput'
import { isChainSupported } from '@/utils/networks'
import { analyzeOwnerKind, type OwnerKind } from '@/utils/ownerKind'
import { fetchConnectedVaultRoleLabel } from '@/utils/connectedVaultRole'
import { fetchVaultOverview } from '@/utils/vaultReader'
import { resolveMarketsForQueues } from '@/utils/resolveVaultMarketsBatch'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import type { VaultUnderlyingMeta } from '@/utils/vaultReader'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

export default function VaultPage() {
  const { provider, chainId, isConnected, connect, switchNetwork, account } = useWeb3()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [supply, setSupply] = useState<ResolvedMarket[]>([])
  const [withdraw, setWithdraw] = useState<ResolvedMarket[]>([])
  const [withdrawMarketStates, setWithdrawMarketStates] = useState<WithdrawMarketOnchainState[]>([])
  const [vaultUnderlyingMeta, setVaultUnderlyingMeta] = useState<VaultUnderlyingMeta | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [supplyQueueSize, setSupplyQueueSize] = useState<number | undefined>(undefined)
  const [withdrawQueueSize, setWithdrawQueueSize] = useState<number | undefined>(undefined)
  const [summary, setSummary] = useState<{
    vault: string
    owner: string
    curator: string
    guardian: string
    timelockSeconds: bigint
    ownerKind: OwnerKind
  } | null>(null)
  const [yourRoleLabel, setYourRoleLabel] = useState('')

  const handleCheck = useCallback(async () => {
    setError('')
    setSupply([])
    setWithdraw([])
    setWithdrawMarketStates([])
    setVaultUnderlyingMeta(null)
    setHasLoaded(false)
    setSupplyQueueSize(undefined)
    setWithdrawQueueSize(undefined)
    setSummary(null)
    setYourRoleLabel('')

    if (!isConnected || !provider || chainId == null) {
      setError('Connect MetaMask to load vault queues.')
      return
    }

    const classified = classifyVaultInput(input)

    if (classified.kind === 'unknown_url') {
      setError(
        'This URL is not a known block explorer for a supported chain. Use a link from one of those explorers (see networks in the header) or paste a plain vault address on your current network.'
      )
      return
    }

    if (classified.kind === 'explorer') {
      if (!isChainSupported(classified.chainId)) {
        setError('The explorer in this URL points to a chain that is not supported here.')
        return
      }
      if (classified.chainId !== chainId) {
        await switchNetwork(classified.chainId)
      }
      const net = await provider.getNetwork()
      const effectiveChainId = Number(net.chainId)
      if (effectiveChainId !== classified.chainId) {
        setError('Switch to the network from the explorer URL in your wallet, then press Check again.')
        return
      }
    } else if (!isChainSupported(chainId)) {
      setError('This network is not in the supported list. Switch network in the header.')
      return
    }

    const raw = extractHexAddressLike(input)
    const vault = normalizeAddress(raw)
    if (!vault) {
      setError('Enter a valid vault address or a block explorer URL containing the contract address.')
      return
    }

    setLoading(true)
    try {
      const overview = await fetchVaultOverview(provider, vault)
      setSupplyQueueSize(overview.supply.length)
      setWithdrawQueueSize(overview.withdraw.length)

      const [ownerKind, resolvedQueues] = await Promise.all([
        analyzeOwnerKind(provider, overview.owner),
        resolveMarketsForQueues(provider, vault, overview.supply, overview.withdraw),
      ])
      setSupply(resolvedQueues.supply)
      setWithdraw(resolvedQueues.withdraw)
      setWithdrawMarketStates(resolvedQueues.withdrawMarketStates)
      setVaultUnderlyingMeta(resolvedQueues.underlyingMeta)
      setSummary({
        vault,
        owner: normalizeAddress(overview.owner) ?? overview.owner,
        curator: normalizeAddress(overview.curator) ?? overview.curator,
        guardian: normalizeAddress(overview.guardian) ?? overview.guardian,
        timelockSeconds: overview.timelockSeconds,
        ownerKind,
      })
      setHasLoaded(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Failed to read vault. Check address and network.')
      setSupplyQueueSize(undefined)
      setWithdrawQueueSize(undefined)
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [input, provider, chainId, isConnected, switchNetwork])

  useEffect(() => {
    if (!hasLoaded || summary == null) {
      return
    }
    if (!account || !provider) {
      setYourRoleLabel('Connect wallet to see your role')
      return
    }
    setYourRoleLabel('…')
    let cancelled = false
    void (async () => {
      try {
        const label = await fetchConnectedVaultRoleLabel(
          provider,
          summary.vault,
          account,
          {
            owner: summary.owner,
            curator: summary.curator,
            guardian: summary.guardian,
          },
          summary.ownerKind
        )
        if (!cancelled) setYourRoleLabel(label)
      } catch {
        if (!cancelled) setYourRoleLabel('—')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasLoaded, summary, provider, account])

  return (
    <div className="silo-page px-4 py-8 sm:px-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
          ← Home
        </Link>
      </div>

      <h1 className="text-3xl font-bold silo-text-main mb-6">Vault</h1>

      {!isConnected && (
        <div className="silo-panel-soft p-4 mb-6 flex flex-wrap items-center gap-3">
          <p className="text-sm silo-text-main">Connect MetaMask to read on-chain data.</p>
          <button
            type="button"
            onClick={() => void connect()}
            className="header-connect-button font-semibold py-2 px-4 rounded-full text-xs"
          >
            Connect MetaMask
          </button>
        </div>
      )}

      <div className="silo-panel silo-top-card p-6 mb-8">
        <label htmlFor="vault-input" className="block text-sm font-medium silo-text-main mb-2">
          Vault address or URL
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="vault-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (loading) return
              void handleCheck()
            }}
            placeholder="0x… or https://…/address/0x…"
            className="flex-1 min-w-0 silo-input silo-input--md font-mono focus:outline-none focus:ring-0"
          />
          <button
            type="button"
            onClick={() => void handleCheck()}
            disabled={loading || !isConnected}
            className="silo-btn-primary shrink-0 self-stretch sm:self-auto"
          >
            {loading ? 'Loading…' : 'Check'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm silo-alert silo-alert-error">{error}</p>}
      </div>

      {chainId != null && hasLoaded && summary != null && (
        <VaultSummaryPanel
          chainId={chainId}
          vaultAddress={summary.vault}
          ownerAddress={summary.owner}
          curatorAddress={summary.curator}
          guardianAddress={summary.guardian}
          timelockSeconds={summary.timelockSeconds}
          ownerKind={summary.ownerKind}
          yourRoleLabel={yourRoleLabel}
          actions={
            <VaultActionsColumn
              chainId={chainId}
              vaultAddress={summary.vault}
              ownerAddress={summary.owner}
              ownerKind={summary.ownerKind}
              supplyQueueMarkets={supply}
              withdrawQueueMarkets={withdraw}
              withdrawQueueStates={withdrawMarketStates}
              vaultUnderlyingMeta={vaultUnderlyingMeta}
            />
          }
        />
      )}

      {chainId != null && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SupplyQueueColumn
            title="Supply Queue"
            count={supplyQueueSize}
            chainId={chainId}
            items={supply}
            loading={loading}
            hasLoaded={hasLoaded}
            emptyMessage={
              loading ? '…' : hasLoaded ? 'Queue is empty' : 'Run Check to load the queue'
            }
            vaultAddress={summary?.vault ?? ''}
            vaultUnderlyingMeta={vaultUnderlyingMeta}
            ownerAddress={summary?.owner ?? ''}
            curatorAddress={summary?.curator ?? ''}
            ownerKind={summary?.ownerKind ?? 'eoa'}
          />
          <QueueColumn
            title="Withdraw Queue"
            count={withdrawQueueSize}
            chainId={chainId}
            items={withdraw}
            loading={loading}
            emptyMessage={
              loading ? '…' : hasLoaded ? 'Queue is empty' : 'Run Check to load the queue'
            }
          />
        </div>
      )}
    </div>
  )
}
