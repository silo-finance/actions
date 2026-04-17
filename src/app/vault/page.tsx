'use client'

import { getAddress } from 'ethers'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import QueueColumn from '@/components/QueueColumn'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import SupplyQueueColumn from '@/components/SupplyQueueColumn'
import VaultActionsColumn from '@/components/VaultActionsColumn'
import VaultSummaryPanel from '@/components/VaultSummaryPanel'
import ConnectWalletModal from '@/components/ConnectWalletModal'
import { VaultPermissionsProvider } from '@/contexts/VaultPermissionsContext'
import { useWeb3 } from '@/contexts/Web3Context'
import { extractHexAddressLike } from '@/utils/addressFromInput'
import { normalizeAddress } from '@/utils/addressValidation'
import { classifyVaultInput } from '@/utils/explorerInput'
import { getNetworkDisplayName, getNetworkIconPath, isChainSupported } from '@/utils/networks'
import { analyzeOwnerKind, type OwnerKind } from '@/utils/ownerKind'
import { fetchConnectedVaultRoleLabel } from '@/utils/connectedVaultRole'
import { fetchVaultOverview } from '@/utils/vaultReader'
import { resolveMarketsForQueues } from '@/utils/resolveVaultMarketsBatch'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import type { VaultUnderlyingMeta } from '@/utils/vaultReader'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'
import {
  fetchVaultsManagedByAccount,
  type SiloV3VaultListItem,
} from '@/utils/siloV3VaultsApi'

/** `chain` query: decimal chain id, must be in our supported list. */
function parseChainFromSearchParam(raw: string | null): number | null {
  if (raw == null || !raw.trim()) return null
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return isChainSupported(n) ? n : null
}

function VaultPageInner() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { provider, chainId, isConnected, switchNetwork, account } = useWeb3()
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const closeConnectModal = useCallback(() => setConnectModalOpen(false), [])
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
    curatorKind: OwnerKind
    guardianKind: OwnerKind
  } | null>(null)
  const [yourRoleLabel, setYourRoleLabel] = useState('')
  const [myVaults, setMyVaults] = useState<SiloV3VaultListItem[]>([])
  const [myVaultsLoading, setMyVaultsLoading] = useState(false)
  const [myVaultsError, setMyVaultsError] = useState('')
  const [showMyVaultsPicker, setShowMyVaultsPicker] = useState(false)
  const myVaultsRef = useRef<SiloV3VaultListItem[]>([])
  myVaultsRef.current = myVaults
  const networkName = chainId != null ? getNetworkDisplayName(chainId) : null
  const networkIconPath = chainId != null ? getNetworkIconPath(chainId) : null
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const networkIconSrc = networkIconPath ? `${basePath}${networkIconPath}` : null

  const chainFromUrl = useMemo(
    () => parseChainFromSearchParam(searchParams.get('chain')),
    [searchParams]
  )

  /** Canonical link to this vault page (not the raw browser URL). */
  const vaultShareUrl = useMemo(() => {
    if (!hasLoaded || !summary?.vault || chainId == null || typeof window === 'undefined') return ''
    if (!isChainSupported(chainId)) return ''
    try {
      const v = getAddress(summary.vault)
      const q = new URLSearchParams()
      q.set('address', v)
      q.set('chain', String(chainId))
      return `${window.location.origin}${basePath}/vault/?${q.toString()}`
    } catch {
      return ''
    }
  }, [hasLoaded, summary?.vault, basePath, chainId])

  const vaultFromUrl = useMemo(() => {
    const raw = searchParams.get('vault') ?? searchParams.get('address')
    if (!raw?.trim()) return null
    return normalizeAddress(extractHexAddressLike(raw.trim()))
  }, [searchParams])

  /** Stable “deep link” identity so we only auto-apply URL `chain` once per navigation, not on every replace(). */
  const linkIdentityKey = useMemo(
    () => `${vaultFromUrl?.toLowerCase() ?? ''}|${chainFromUrl ?? ''}`,
    [vaultFromUrl, chainFromUrl]
  )

  const prevLinkIdentityKey = useRef<string | null>(null)
  const [deepLinkChainApplied, setDeepLinkChainApplied] = useState(() => chainFromUrl == null)

  useEffect(() => {
    if (prevLinkIdentityKey.current === null) {
      prevLinkIdentityKey.current = linkIdentityKey
      return
    }
    if (prevLinkIdentityKey.current !== linkIdentityKey) {
      prevLinkIdentityKey.current = linkIdentityKey
      setDeepLinkChainApplied(chainFromUrl == null)
    }
  }, [linkIdentityKey, chainFromUrl])

  useEffect(() => {
    if (vaultFromUrl) {
      setInput(vaultFromUrl)
    }
  }, [vaultFromUrl])

  /** Once per deep link: if URL contains `chain`, switch wallet to it. After that, header / wallet is source of truth. */
  useEffect(() => {
    if (!isConnected || chainId == null) return
    if (deepLinkChainApplied) return
    if (chainFromUrl == null || !isChainSupported(chainFromUrl)) {
      setDeepLinkChainApplied(true)
      return
    }
    if (chainId === chainFromUrl) {
      setDeepLinkChainApplied(true)
      return
    }
    void switchNetwork(chainFromUrl).finally(() => {
      setDeepLinkChainApplied(true)
    })
  }, [isConnected, chainId, chainFromUrl, switchNetwork, deepLinkChainApplied])

  const performCheck = useCallback(
    async (rawInput: string, reopenMyVaultsPickerOnError = false) => {
      setShowMyVaultsPicker(false)
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
        setError('Connect a wallet to load vault queues.')
        return
      }

      const classified = classifyVaultInput(rawInput)

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
      } else if (chainId == null || !isChainSupported(chainId)) {
        setError('This network is not in the supported list. Switch network in the header.')
        return
      }

      const raw = extractHexAddressLike(rawInput)
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

        const [ownerKind, curatorKind, guardianKind, resolvedQueues] = await Promise.all([
          analyzeOwnerKind(provider, overview.owner),
          analyzeOwnerKind(provider, overview.curator),
          analyzeOwnerKind(provider, overview.guardian),
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
          curatorKind,
          guardianKind,
        })
        setHasLoaded(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg || 'Failed to read vault. Check address and network.')
        setSupplyQueueSize(undefined)
        setWithdrawQueueSize(undefined)
        setSummary(null)
        if (reopenMyVaultsPickerOnError && myVaultsRef.current.length > 0) {
          setShowMyVaultsPicker(true)
        }
      } finally {
        setLoading(false)
      }
    },
    [provider, chainId, isConnected, switchNetwork]
  )

  const handleCheck = useCallback(() => {
    void performCheck(input, false)
  }, [performCheck, input])

  useEffect(() => {
    if (!isConnected || !account || chainId == null || !isChainSupported(chainId)) {
      setMyVaults([])
      setMyVaultsError('')
      setMyVaultsLoading(false)
      setShowMyVaultsPicker(false)
      return
    }

    let cancelled = false
    setMyVaultsLoading(true)
    setMyVaultsError('')
    void (async () => {
      try {
        const items = await fetchVaultsManagedByAccount(account, chainId)
        if (!cancelled) {
          setMyVaults(items)
          setShowMyVaultsPicker(items.length > 0)
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e)
          setMyVaultsError(msg || 'Could not load vault list from Silo API.')
          setMyVaults([])
        }
      } finally {
        if (!cancelled) setMyVaultsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isConnected, account, chainId])

  const selectVaultFromApi = useCallback(
    (vaultId: string) => {
      setInput(vaultId)
      void performCheck(vaultId, true)
    },
    [performCheck]
  )

  /** After Check: normalize `address` + `chain` in the URL to the loaded vault (only when deep link bootstrap finished). */
  useEffect(() => {
    if (!deepLinkChainApplied) return
    if (!hasLoaded || !summary?.vault || !pathname || chainId == null) return
    if (!isChainSupported(chainId)) return
    const p = new URLSearchParams(searchParams.toString())
    const curAddr = (p.get('vault') ?? p.get('address'))?.toLowerCase()
    const curChain = p.get('chain')
    if (curAddr === summary.vault.toLowerCase() && curChain === String(chainId)) return
    p.delete('vault')
    p.set('address', summary.vault)
    p.set('chain', String(chainId))
    const qs = p.toString()
    void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [deepLinkChainApplied, hasLoaded, summary?.vault, chainId, pathname, router, searchParams])

  /** Before / without Check: keep `chain` query aligned with the wallet when the user changes network in the header. */
  useEffect(() => {
    if (!deepLinkChainApplied) return
    if (!pathname || chainId == null || !isChainSupported(chainId)) return
    if (hasLoaded && summary) return

    const p = new URLSearchParams(searchParams.toString())
    if (p.get('chain') === String(chainId)) return
    p.set('chain', String(chainId))
    const qs = p.toString()
    void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [deepLinkChainApplied, pathname, chainId, router, searchParams, hasLoaded, summary])

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
          summary.ownerKind,
          summary.curatorKind,
          summary.guardianKind
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

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-3xl font-bold silo-text-main m-0 leading-none">Vault</h1>
          {vaultShareUrl ? (
            <ShareLinkCopyButton
              url={vaultShareUrl}
              className="self-center shrink-0 -mt-0.5"
              iconClassName="w-4 h-4"
            />
          ) : null}
          {networkName ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-1.5">
              {networkIconSrc ? (
                <Image src={networkIconSrc} alt={networkName} width={16} height={16} className="rounded-full" />
              ) : null}
              <span className="text-sm font-semibold silo-text-main"> {networkName}</span>
            </div>
          ) : null}
        </div>
        {isConnected && myVaults.length > 0 ? (
          <button
            type="button"
            className="silo-btn-secondary text-sm shrink-0"
            onClick={() => setShowMyVaultsPicker((open) => !open)}
          >
            {showMyVaultsPicker ? 'Hide my vaults' : 'My vaults'}
          </button>
        ) : null}
      </div>

      {!isConnected && (
        <div className="silo-panel-soft p-4 mb-6 flex flex-wrap items-center gap-3">
          <p className="text-sm silo-text-main">Connect a wallet (browser extension or WalletConnect) to read on-chain data.</p>
          <button
            type="button"
            onClick={() => setConnectModalOpen(true)}
            className="header-connect-button font-semibold py-2.5 px-4 rounded-full text-sm"
          >
            Connect wallet
          </button>
          <ConnectWalletModal open={connectModalOpen} onClose={closeConnectModal} />
        </div>
      )}

      <div className="silo-panel silo-top-card p-6 mb-8">
        <label htmlFor="vault-input" className="block text-sm font-medium silo-text-main mb-2">
          Enter the vault address or blockchain explorer URL
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
            placeholder="0x… or supported explorer link to the vault contract"
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
        {isConnected && chainId != null && isChainSupported(chainId) ? (
          <div className="mt-4">
            {myVaultsLoading ? (
              <p className="text-xs silo-text-soft m-0">Loading vaults you manage (Silo API)…</p>
            ) : null}
            {myVaultsError && !myVaultsLoading ? (
              <p className="text-xs silo-alert silo-alert-error m-0">{myVaultsError}</p>
            ) : null}
            {showMyVaultsPicker && myVaults.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">Your vaults</p>
                <ul className="space-y-2 m-0 p-0 list-none">
                  {myVaults.map((v) => (
                    <li key={v.id.toLowerCase()}>
                      <button
                        type="button"
                        className="silo-choice-option text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        data-selected="false"
                        disabled={loading}
                        onClick={() => selectVaultFromApi(v.id)}
                      >
                        <span className="block min-w-0 flex-1">
                          <span className="block text-sm font-semibold silo-text-main">
                            {v.name?.trim() ? v.name.trim() : 'Unnamed vault'}
                          </span>
                          <span className="block text-xs font-mono silo-text-soft mt-0.5 break-all">{v.id}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {chainId != null && (
        <VaultPermissionsProvider
          enabled={Boolean(isConnected && account && hasLoaded && summary)}
          summary={
            summary != null
              ? {
                  vault: summary.vault,
                  owner: summary.owner,
                  curator: summary.curator,
                  ownerKind: summary.ownerKind,
                  curatorKind: summary.curatorKind,
                }
              : null
          }
        >
          {hasLoaded && summary != null && (
            <VaultSummaryPanel
              chainId={chainId}
              vaultAddress={summary.vault}
              ownerAddress={summary.owner}
              curatorAddress={summary.curator}
              guardianAddress={summary.guardian}
              timelockSeconds={summary.timelockSeconds}
              ownerKind={summary.ownerKind}
              curatorKind={summary.curatorKind}
              guardianKind={summary.guardianKind}
              yourRoleLabel={yourRoleLabel}
              actions={
                <VaultActionsColumn
                  chainId={chainId}
                  vaultAddress={summary.vault}
                  ownerAddress={summary.owner}
                  curatorAddress={summary.curator}
                  ownerKind={summary.ownerKind}
                  curatorKind={summary.curatorKind}
                  supplyQueueMarkets={supply}
                  withdrawQueueMarkets={withdraw}
                  withdrawQueueStates={withdrawMarketStates}
                  vaultUnderlyingMeta={vaultUnderlyingMeta}
                />
              }
            />
          )}

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
              curatorKind={summary?.curatorKind ?? 'eoa'}
            />
            <QueueColumn
              title="Withdraw Queue"
              count={withdrawQueueSize}
              chainId={chainId}
              items={withdraw}
              queueStates={withdrawMarketStates}
              loading={loading}
              emptyMessage={
                loading ? '…' : hasLoaded ? 'Queue is empty' : 'Run Check to load the queue'
              }
            />
          </div>
        </VaultPermissionsProvider>
      )}
    </div>
  )
}

export default function VaultPage() {
  return (
    <Suspense
      fallback={
        <div className="silo-page px-4 py-8 sm:px-6 max-w-6xl mx-auto">
          <p className="text-sm silo-text-soft m-0">Loading…</p>
        </div>
      }
    >
      <VaultPageInner />
    </Suspense>
  )
}
