'use client'

import { getAddress } from 'ethers'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import QueueColumn from '@/components/QueueColumn'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import SupplyQueueColumn from '@/components/SupplyQueueColumn'
import VaultActionsColumn from '@/components/VaultActionsColumn'
import VaultSummaryPanel from '@/components/VaultSummaryPanel'
import ConnectWalletModal from '@/components/ConnectWalletModal'
import { VaultPermissionsNotice, VaultPermissionsProvider } from '@/contexts/VaultPermissionsContext'
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

type CheckLoadSource = 'manual_check' | 'deep_link_auto'

function VaultPageInner() {
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
  /** True after the Silo API vault-list request finishes for the current wallet + chain (success or error). */
  const [myVaultsListResolved, setMyVaultsListResolved] = useState(false)
  const [showMyVaultsPicker, setShowMyVaultsPicker] = useState(false)
  const myVaultsRef = useRef<SiloV3VaultListItem[]>([])
  myVaultsRef.current = myVaults
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const initialQueryParams = useMemo(
    () => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    []
  )

  const chainFromUrl = useMemo(
    () => parseChainFromSearchParam(initialQueryParams.get('chain')),
    [initialQueryParams]
  )
  const vaultFromUrl = useMemo(() => {
    const raw = initialQueryParams.get('vault') ?? initialQueryParams.get('address')
    if (!raw?.trim()) return null
    return normalizeAddress(extractHexAddressLike(raw.trim()))
  }, [initialQueryParams])
  const linkIdentityKey = useMemo(
    () => `${vaultFromUrl?.toLowerCase() ?? ''}|${chainFromUrl ?? ''}`,
    [vaultFromUrl, chainFromUrl]
  )
  const initialDeepLinkIdentityRef = useRef(linkIdentityKey)
  const isInitialDeepLinkIdentity = linkIdentityKey === initialDeepLinkIdentityRef.current
  const [deepLinkChainApplied, setDeepLinkChainApplied] = useState(() => chainFromUrl == null)
  const deepLinkAutoCheckKeyRef = useRef<string | null>(null)
  const deepLinkSwitchStartedRef = useRef(false)
  const [lastSuccessfulCheck, setLastSuccessfulCheck] = useState<{
    vault: string
    chainId: number
    source: CheckLoadSource
    nonce: number
  } | null>(null)
  const checkSuccessNonceRef = useRef(0)
  const vaultDisplayChainId = useMemo(
    () => (hasLoaded && lastSuccessfulCheck ? lastSuccessfulCheck.chainId : chainId),
    [hasLoaded, lastSuccessfulCheck, chainId]
  )
  const isWalletOnLoadedChain =
    !lastSuccessfulCheck || chainId == null || chainId === lastSuccessfulCheck.chainId
  const networkName = vaultDisplayChainId != null ? getNetworkDisplayName(vaultDisplayChainId) : null
  const networkIconPath = vaultDisplayChainId != null ? getNetworkIconPath(vaultDisplayChainId) : null
  const networkIconSrc = networkIconPath ? `${basePath}${networkIconPath}` : null

  /** Current wallet chain (for "My vaults" API section only; not the loaded-vault display chain). */
  const walletChainName = chainId != null ? getNetworkDisplayName(chainId) : null
  const walletChainIconPath = chainId != null ? getNetworkIconPath(chainId) : null
  const walletChainIconSrc = walletChainIconPath ? `${basePath}${walletChainIconPath}` : null
  const accountChecksum = account ? normalizeAddress(account) ?? account : null
  const accountShort = accountChecksum ? `${accountChecksum.slice(0, 6)}…${accountChecksum.slice(-4)}` : null

  /** Canonical link to this vault page (not the raw browser URL). */
  const vaultShareUrl = useMemo(() => {
    if (!hasLoaded || !summary?.vault || !lastSuccessfulCheck || chainId == null || typeof window === 'undefined') {
      return ''
    }
    if (!isChainSupported(chainId) || chainId !== lastSuccessfulCheck.chainId) return ''
    if (summary.vault.toLowerCase() !== lastSuccessfulCheck.vault.toLowerCase()) return ''
    try {
      const v = getAddress(summary.vault)
      const q = new URLSearchParams()
      q.set('address', v)
      q.set('chain', String(lastSuccessfulCheck.chainId))
      return `${window.location.origin}${basePath}/vault/?${q.toString()}`
    } catch {
      return ''
    }
  }, [hasLoaded, summary?.vault, basePath, chainId, lastSuccessfulCheck])

  const resetLoadedVaultState = useCallback(() => {
    setSupply([])
    setWithdraw([])
    setWithdrawMarketStates([])
    setVaultUnderlyingMeta(null)
    setHasLoaded(false)
    setSupplyQueueSize(undefined)
    setWithdrawQueueSize(undefined)
    setSummary(null)
    setYourRoleLabel('')
  }, [])

  useEffect(() => {
    if (vaultFromUrl) {
      setInput(vaultFromUrl)
    }
  }, [vaultFromUrl])

  /** Once per deep link: if URL contains `chain`, switch wallet to it. After that, header / wallet is source of truth. */
  useEffect(() => {
    if (!isInitialDeepLinkIdentity) return
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
    if (deepLinkSwitchStartedRef.current) return
    deepLinkSwitchStartedRef.current = true
    void switchNetwork(chainFromUrl).finally(() => {
      setDeepLinkChainApplied(true)
    })
  }, [isConnected, chainId, chainFromUrl, switchNetwork, deepLinkChainApplied, isInitialDeepLinkIdentity])

  const performCheck = useCallback(
    async (
      rawInput: string,
      reopenMyVaultsPickerOnError = false,
      source: CheckLoadSource = 'manual_check'
    ) => {
      setShowMyVaultsPicker(false)
      setError('')
      resetLoadedVaultState()

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

      const net = await provider.getNetwork()
      const effectiveChainId = Number(net.chainId)
      if (!isChainSupported(effectiveChainId)) {
        setError('This network is not in the supported list. Switch network in the header.')
        return
      }
      if (classified.kind === 'explorer' && effectiveChainId !== classified.chainId) {
        setError('Switch to the network from the explorer URL in your wallet, then press Check again.')
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
        checkSuccessNonceRef.current += 1
        const successSnapshot = {
          vault,
          chainId: effectiveChainId,
          source,
          nonce: checkSuccessNonceRef.current,
        }
        setLastSuccessfulCheck(successSnapshot)

        // Keep URL canonical only after a successful Check.
        if (pathname) {
          const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
          const hasVaultAlias = p.has('vault')
          const addressParam = p.get('address')
          const canonicalAddr = successSnapshot.vault.toLowerCase()
          const canonicalChain = String(successSnapshot.chainId)
          const alreadyCanonical =
            !hasVaultAlias &&
            typeof addressParam === 'string' &&
            addressParam.toLowerCase() === canonicalAddr &&
            p.get('chain') === canonicalChain

          if (!alreadyCanonical) {
            p.delete('vault')
            p.set('address', successSnapshot.vault)
            p.set('chain', canonicalChain)
            const qs = p.toString()
            void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
          }
        }
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
    [provider, chainId, isConnected, switchNetwork, resetLoadedVaultState, pathname, router]
  )

  const handleCheck = useCallback(() => {
    void performCheck(input, false, 'manual_check')
  }, [performCheck, input])

  useEffect(() => {
    if (!isInitialDeepLinkIdentity) return
    if (!deepLinkChainApplied) return
    if (loading || hasLoaded) return
    if (!isConnected || !provider || chainId == null) return
    if (!vaultFromUrl || chainFromUrl == null || !isChainSupported(chainFromUrl)) return
    if (chainId !== chainFromUrl) return

    const autoKey = `${linkIdentityKey}|${(account ?? '').toLowerCase()}`
    if (deepLinkAutoCheckKeyRef.current === autoKey) return
    deepLinkAutoCheckKeyRef.current = autoKey
    void performCheck(vaultFromUrl, false, 'deep_link_auto')
  }, [
    isInitialDeepLinkIdentity,
    deepLinkChainApplied,
    loading,
    hasLoaded,
    isConnected,
    provider,
    chainId,
    vaultFromUrl,
    chainFromUrl,
    linkIdentityKey,
    account,
    performCheck,
  ])

  useEffect(() => {
    if (!isConnected || !account || chainId == null || !isChainSupported(chainId)) {
      setMyVaults([])
      setMyVaultsError('')
      setMyVaultsLoading(false)
      setShowMyVaultsPicker(false)
      setMyVaultsListResolved(false)
      return
    }

    let cancelled = false
    setMyVaultsListResolved(false)
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
          setMyVaultsError(
            msg
              ? `Could not load your vault list from the Silo indexer API. ${msg}`
              : 'Could not load your vault list from the Silo indexer API.'
          )
          setMyVaults([])
          setShowMyVaultsPicker(false)
        }
      } finally {
        if (!cancelled) {
          setMyVaultsLoading(false)
          setMyVaultsListResolved(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isConnected, account, chainId])

  const selectVaultFromApi = useCallback(
    (vaultId: string) => {
      setInput(vaultId)
      void performCheck(vaultId, true, 'manual_check')
    },
    [performCheck]
  )

  useEffect(() => {
    if (!hasLoaded || summary == null) {
      return
    }
    if (!isWalletOnLoadedChain) {
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
  }, [hasLoaded, summary, provider, account, isWalletOnLoadedChain])

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
              <p className="text-xs silo-text-soft m-0">Loading vaults you manage (Silo indexer API)…</p>
            ) : null}
            {myVaultsError && !myVaultsLoading ? (
              <p className="mt-3 text-sm silo-alert silo-alert-error m-0" role="alert">
                {myVaultsError}
              </p>
            ) : null}
            {myVaultsListResolved &&
            !myVaultsLoading &&
            !myVaultsError &&
            myVaults.length === 0 ? (
              <p className="mt-3 text-xs silo-alert silo-alert-info m-0 leading-relaxed">
                We checked{' '}
                {accountShort ? (
                  <span
                    className="text-xs font-mono font-semibold silo-text-main align-middle"
                    title={accountChecksum ?? undefined}
                  >
                    {accountShort}
                  </span>
                ) : (
                  <span className="text-xs font-semibold silo-text-main">this wallet</span>
                )}{' '}
                on{' '}
                <span className="inline-flex items-center gap-1 align-middle">
                  {walletChainIconSrc && walletChainName ? (
                    <Image
                      src={walletChainIconSrc}
                      alt=""
                      width={16}
                      height={16}
                      className="rounded-full shrink-0"
                    />
                  ) : null}
                  <span className="text-xs font-semibold silo-text-main">
                    {walletChainName ?? 'the current network'}
                  </span>
                </span>
                . No vaults were found where this wallet is owner, curator, or guardian in the Silo v3 indexer. (If
                you are only an allocator, this list cannot show those vaults — paste the vault contract address
                above.)
              </p>
            ) : null}
            {showMyVaultsPicker && myVaults.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0 flex flex-wrap items-center gap-1.5">
                  <span>Your vaults on</span>
                  {walletChainIconSrc && walletChainName ? (
                    <>
                      <Image
                        src={walletChainIconSrc}
                        alt=""
                        width={16}
                        height={16}
                        className="rounded-full shrink-0"
                      />
                      <span className="normal-case silo-text-main">{walletChainName}</span>
                    </>
                  ) : null}
                </p>
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

      {vaultDisplayChainId != null && (
        <VaultPermissionsProvider
          enabled={Boolean(isConnected && account && hasLoaded && summary)}
          freeze={Boolean(hasLoaded && summary && !isWalletOnLoadedChain)}
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
          <VaultPermissionsNotice />
          {hasLoaded && summary != null && (
            <VaultSummaryPanel
              chainId={vaultDisplayChainId}
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
                  chainId={vaultDisplayChainId}
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
              chainId={vaultDisplayChainId}
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
              chainId={vaultDisplayChainId}
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
