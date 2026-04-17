'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import {
  classifyAllocatorVaultAction,
  classifyOwnerOrCuratorVaultAction,
} from '@/utils/vaultActionAuthority'
import type { VaultActionAuthority } from '@/utils/vaultActionAuthority'
import { formatWalletRpcFailureMessage } from '@/utils/rpcErrors'

export type VaultPermissionsSummary = {
  vault: string
  owner: string
  curator: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
}

type VaultPermissionsContextValue = {
  /** False when wallet disconnected, vault not loaded, or no summary. */
  active: boolean
  loading: boolean
  /** Set when on-chain permission checks failed (e.g. wallet RPC 429); auths stay null until retry succeeds. */
  classificationError: string | null
  /** Re-runs allocator + owner/curator classification (same vault/account). */
  retryPermissionCheck: () => void
  /** True when connected, checks finished without error, and both authority objects are present. */
  permissionsReady: boolean
  allocatorAuth: VaultActionAuthority | null
  ownerCuratorAuth: VaultActionAuthority | null
  canAllocator: boolean
  canOwnerOrCurator: boolean
}

const VaultPermissionsContext = createContext<VaultPermissionsContextValue | null>(null)

type ProviderProps = {
  children: ReactNode
  /** When true, runs classification for `summary` and `account`. */
  enabled: boolean
  summary: VaultPermissionsSummary | null
}

export function VaultPermissionsProvider({ children, enabled, summary }: ProviderProps) {
  const { provider, account } = useWeb3()
  const [loading, setLoading] = useState(false)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [allocatorAuth, setAllocatorAuth] = useState<VaultActionAuthority | null>(null)
  const [ownerCuratorAuth, setOwnerCuratorAuth] = useState<VaultActionAuthority | null>(null)

  const retryPermissionCheck = useCallback(() => {
    setClassificationError(null)
    setRetryNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !summary || !provider || !account) {
      setAllocatorAuth(null)
      setOwnerCuratorAuth(null)
      setClassificationError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setClassificationError(null)
    let cancelled = false
    const overview = { owner: summary.owner, curator: summary.curator }

    void (async () => {
      try {
        const [a, o] = await Promise.all([
          classifyAllocatorVaultAction(
            provider,
            summary.vault,
            account,
            overview,
            summary.ownerKind,
            summary.curatorKind
          ),
          classifyOwnerOrCuratorVaultAction(
            provider,
            account,
            overview,
            summary.ownerKind,
            summary.curatorKind
          ),
        ])
        if (!cancelled) {
          setAllocatorAuth(a)
          setOwnerCuratorAuth(o)
          setClassificationError(null)
        }
      } catch (e) {
        console.error('VaultPermissionsProvider classification', e)
        if (!cancelled) {
          setAllocatorAuth(null)
          setOwnerCuratorAuth(null)
          setClassificationError(formatWalletRpcFailureMessage(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, summary, provider, account, retryNonce])

  const value = useMemo((): VaultPermissionsContextValue => {
    const active = Boolean(enabled && summary && account)
    const permissionsReady = Boolean(
      active &&
        !loading &&
        classificationError == null &&
        allocatorAuth != null &&
        ownerCuratorAuth != null
    )
    const canAllocator = permissionsReady && allocatorAuth!.mode !== 'denied'
    const canOwnerOrCurator = permissionsReady && ownerCuratorAuth!.mode !== 'denied'
    return {
      active,
      loading,
      classificationError,
      retryPermissionCheck,
      permissionsReady,
      allocatorAuth,
      ownerCuratorAuth,
      canAllocator,
      canOwnerOrCurator,
    }
  }, [
    enabled,
    summary,
    account,
    loading,
    classificationError,
    retryPermissionCheck,
    allocatorAuth,
    ownerCuratorAuth,
  ])

  return <VaultPermissionsContext.Provider value={value}>{children}</VaultPermissionsContext.Provider>
}

export function useVaultPermissions(): VaultPermissionsContextValue {
  const ctx = useContext(VaultPermissionsContext)
  if (ctx == null) {
    throw new Error('useVaultPermissions must be used within VaultPermissionsProvider')
  }
  return ctx
}

/** Inline banner when wallet RPC fails during vault permission checks (e.g. Arbitrum 429). */
export function VaultPermissionsNotice() {
  const { classificationError, loading, retryPermissionCheck } = useVaultPermissions()
  if (classificationError == null) return null
  return (
    <div className="silo-alert silo-alert-error mb-4 flex flex-col gap-3" role="alert">
      <p className="text-sm m-0 min-w-0 leading-relaxed silo-text-main">{classificationError}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="silo-btn-secondary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed py-2 px-4 text-sm"
          disabled={loading}
          onClick={() => retryPermissionCheck()}
        >
          {loading ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    </div>
  )
}
