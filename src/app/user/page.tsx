'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BrowserProvider, type Provider } from 'ethers'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import UserLookupForm from '@/components/user/UserLookupForm'
import UserPositionSummary from '@/components/user/UserPositionSummary'
import SiloUserCard from '@/components/user/SiloUserCard'
import { useWeb3 } from '@/contexts/Web3Context'
import { extractHexAddressLike } from '@/utils/addressFromInput'
import { normalizeAddress } from '@/utils/addressValidation'
import { classifyVaultInput } from '@/utils/explorerInput'
import { getReadonlyProvider } from '@/utils/liquidationRpc'
import { getNetworkDisplayName, getNetworkIconPath, isChainSupported } from '@/utils/networks'
import { resolveSiloInput } from '@/utils/resolveSiloInput'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import { readUserSiloPosition, type UserSiloPosition } from '@/utils/userSiloReader'

function parseChainFromSearchParam(raw: string | null): number | null {
  if (raw == null || !raw.trim()) return null
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = parseInt(t, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return isChainSupported(n) ? n : null
}

function siloLabel(index: number): string {
  return `Silo${index}`
}

function UserPageInner() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { chainId, isConnected, switchNetwork, eip1193Provider } = useWeb3()

  const [userInput, setUserInput] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<UserSiloPosition | null>(null)
  const [resolvedChainId, setResolvedChainId] = useState<number | null>(null)

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''

  /** Drive everything off the reactive `useSearchParams()` hook so deep links resolve on the client. */
  const userParam = searchParams.get('user')
  const addressParam = searchParams.get('address')
  const chainParam = searchParams.get('chain')
  const userFromUrl = useMemo(
    () => (userParam?.trim() ? normalizeAddress(extractHexAddressLike(userParam.trim())) : null),
    [userParam]
  )
  const addressFromUrl = useMemo(
    () => (addressParam?.trim() ? normalizeAddress(extractHexAddressLike(addressParam.trim())) : null),
    [addressParam]
  )
  const chainFromUrl = useMemo(() => parseChainFromSearchParam(chainParam), [chainParam])

  /** Seed the form inputs from the URL once, so the deep-link tab shows the resolved addresses. */
  const formSeededRef = useRef(false)
  useEffect(() => {
    if (formSeededRef.current) return
    if (!userParam?.trim() && !addressParam?.trim()) return
    formSeededRef.current = true
    if (userParam?.trim()) setUserInput(userFromUrl ?? userParam.trim())
    if (addressParam?.trim()) setAddressInput(addressFromUrl ?? addressParam.trim())
  }, [userParam, addressParam, userFromUrl, addressFromUrl])

  const displayChainId = resolvedChainId ?? chainFromUrl ?? chainId
  const networkName = displayChainId != null ? getNetworkDisplayName(displayChainId) : null
  const networkIconSrc = displayChainId != null ? getNetworkIconPath(displayChainId) : null

  const shareUrl = useMemo(() => {
    if (!position || resolvedChainId == null || typeof window === 'undefined') return ''
    const q = new URLSearchParams()
    q.set('user', position.user)
    q.set('address', position.siloConfig)
    q.set('chain', String(resolvedChainId))
    return `${window.location.origin}${basePath}/user/?${q.toString()}`
  }, [position, resolvedChainId, basePath])

  const performLookup = useCallback(
    async (rawUser: string, rawAddress: string) => {
      setError(null)
      setPosition(null)

      const user = normalizeAddress(extractHexAddressLike(rawUser))
      if (!user) {
        setError('Enter a valid user address.')
        return
      }

      const classified = classifyVaultInput(rawAddress)
      if (classified.kind === 'unknown_url') {
        setError('This URL is not a known block explorer for a supported chain. Paste a plain address instead.')
        return
      }

      let targetChainId: number | null = null
      if (classified.kind === 'explorer') {
        if (!isChainSupported(classified.chainId)) {
          setError('The explorer in this URL points to a chain that is not supported here.')
          return
        }
        targetChainId = classified.chainId
      } else {
        targetChainId = chainFromUrl ?? (chainId != null && isChainSupported(chainId) ? chainId : null)
      }

      if (targetChainId == null) {
        setError('Connect a wallet or paste a block explorer URL so we know which network to read.')
        return
      }

      const siloTarget = normalizeAddress(extractHexAddressLike(rawAddress))
      if (!siloTarget) {
        setError('Enter a valid Silo or SiloConfig address, or a block explorer URL.')
        return
      }

      setLoading(true)
      try {
        /**
         * When a wallet is connected, switch it to the target chain (if needed) and read through
         * the wallet's own RPC — usually healthier than the bundled public endpoint (Ethereum's
         * public RPCs often rate-limit or require an API key). If the user rejects the switch, or
         * no wallet is connected (e.g. a deep link in a fresh tab), fall back to the read-only
         * public provider so the lookup still works.
         */
        let provider: Provider = getReadonlyProvider(targetChainId)
        if (isConnected && eip1193Provider) {
          try {
            if (chainId !== targetChainId) await switchNetwork(targetChainId)
            provider = new BrowserProvider(eip1193Provider, targetChainId)
          } catch {
            provider = getReadonlyProvider(targetChainId)
          }
        }
        const resolved = await resolveSiloInput(provider, siloTarget)
        const result = await readUserSiloPosition(
          provider,
          targetChainId,
          resolved.siloConfig,
          resolved.silos,
          user
        )
        setPosition(result)
        setResolvedChainId(targetChainId)

        if (pathname && typeof window !== 'undefined') {
          const p = new URLSearchParams(window.location.search)
          const already =
            p.get('user')?.toLowerCase() === user.toLowerCase() &&
            p.get('address')?.toLowerCase() === result.siloConfig.toLowerCase() &&
            p.get('chain') === String(targetChainId)
          if (!already) {
            p.set('user', user)
            p.set('address', result.siloConfig)
            p.set('chain', String(targetChainId))
            const qs = p.toString()
            void router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
          }
        }
      } catch (e) {
        setError(toUserErrorMessage(e, 'Failed to read user data. Check the addresses and network.'))
      } finally {
        setLoading(false)
      }
    },
    [chainId, chainFromUrl, isConnected, switchNetwork, eip1193Provider, pathname, router]
  )

  const handleSubmit = useCallback(() => {
    void performLookup(userInput, addressInput)
  }, [performLookup, userInput, addressInput])

  /** Auto-run a deep link (`?user=&address=&chain=`) once on load — no wallet required. */
  const deepLinkRanRef = useRef(false)
  useEffect(() => {
    if (deepLinkRanRef.current) return
    if (!userFromUrl || !addressFromUrl || chainFromUrl == null) return
    deepLinkRanRef.current = true
    void performLookup(userFromUrl, addressFromUrl)
  }, [userFromUrl, addressFromUrl, chainFromUrl, performLookup])

  /** Clear results when the URL query is emptied (e.g. navigating back to a bare `/user`). */
  useEffect(() => {
    if (searchParams.get('user') || searchParams.get('address') || searchParams.get('chain')) return
    setUserInput('')
    setAddressInput('')
    setError(null)
    setPosition(null)
    setResolvedChainId(null)
  }, [searchParams])

  return (
    <div className="silo-page px-4 py-8 sm:px-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main">
          ← Home
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-3xl font-bold silo-text-main m-0 leading-none">User</h1>
          {shareUrl ? (
            <ShareLinkCopyButton url={shareUrl} className="self-center shrink-0 -mt-0.5" iconClassName="w-4 h-4" />
          ) : null}
          {networkName ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-1.5">
              {networkIconSrc ? (
                <Image src={networkIconSrc} alt={networkName} width={16} height={16} className="rounded-full" />
              ) : null}
              <span className="text-sm font-semibold silo-text-main">{networkName}</span>
            </div>
          ) : null}
        </div>
      </div>

      <UserLookupForm
        userValue={userInput}
        addressValue={addressInput}
        onUserChange={setUserInput}
        onAddressChange={setAddressInput}
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
      />

      {position && displayChainId != null ? (
        <>
          <UserPositionSummary
            chainId={displayChainId}
            position={position}
            lensAvailable={position.ltv != null}
          />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {position.silos.map((silo, idx) => (
              <SiloUserCard key={silo.silo} chainId={displayChainId} label={siloLabel(idx)} data={silo} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function UserPage() {
  return (
    <Suspense
      fallback={
        <div className="silo-page px-4 py-8 sm:px-6 max-w-4xl mx-auto">
          <p className="text-sm silo-text-soft m-0">Loading…</p>
        </div>
      }
    >
      <UserPageInner />
    </Suspense>
  )
}
