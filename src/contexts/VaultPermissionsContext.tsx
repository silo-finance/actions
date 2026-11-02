'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import {
  classifyAllocatorVaultActionOnChain,
  classifyOwnerOrCuratorVaultActionOnChain,
} from '@/utils/vaultActionAuthority'
import type { VaultActionAuthority } from '@/utils/vaultActionAuthority'
import { formatWalletRpcFailureMessage } from '@/utils/rpcErrors'
import {
  authoritiesForVaultRolePreview,
  setVaultRolePreview,
  type VaultPreviewRole,
  type VaultPreviewTargets,
} from '@/utils/vaultRolePreview'

function isExpectedNetworkSwitchError(error: unknown): boolean {
  const e = error as { code?: string; event?: string; message?: string }
  if (e.code === 'NETWORK_ERROR' && e.event === 'changed') return true
  const msg = (e.message ?? '').toLowerCase()
  return msg.includes('network changed')
}

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
  /** Selected virtual role, or null when the UI uses the on-chain role. */
  previewRole: VaultPreviewRole | null
  setPreviewRole: (role: VaultPreviewRole) => void
  clearPreviewRole: () => void
}

const VaultPermissionsContext = createContext<VaultPermissionsContextValue | null>(null)

type ProviderProps = {
  children: ReactNode
  /** When true, runs classification for `summary` and `account`. */
  enabled: boolean
  /** When true, keep last resolved permissions and skip reclassification. */
  freeze?: boolean
  summary: VaultPermissionsSummary | null
}

export function VaultPermissionsProvider({ children, enabled, freeze = false, summary }: ProviderProps) {
  const { provider, account } = useWeb3()
  const [loading, setLoading] = useState(false)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [allocatorAuth, setAllocatorAuth] = useState<VaultActionAuthority | null>(null)
  const [ownerCuratorAuth, setOwnerCuratorAuth] = useState<VaultActionAuthority | null>(null)
  const previewScopeKey = `${summary?.vault.toLowerCase() ?? ''}|${account?.toLowerCase() ?? ''}`
  const [appliedPreviewScope, setAppliedPreviewScope] = useState(previewScopeKey)
  const [previewRole, setPreviewRoleState] = useState<VaultPreviewRole | null>(null)

  if (appliedPreviewScope !== previewScopeKey) {
    setAppliedPreviewScope(previewScopeKey)
    setVaultRolePreview(null)
    if (previewRole != null) setPreviewRoleState(null)
  }

  const previewTargets = useMemo((): VaultPreviewTargets | null => {
    if (summary == null) return null
    return {
      owner: summary.owner,
      curator: summary.curator,
      ownerKind: summary.ownerKind,
      curatorKind: summary.curatorKind,
    }
  }, [summary])

  const setPreviewRole = useCallback(
    (role: VaultPreviewRole) => {
      if (previewTargets == null) return
      setVaultRolePreview(role, previewTargets)
      setPreviewRoleState(role)
    },
    [previewTargets]
  )

  const clearPreviewRole = useCallback(() => {
    setVaultRolePreview(null)
    setPreviewRoleState(null)
  }, [])

  useEffect(() => {
    if (previewRole == null || previewTargets == null) {
      setVaultRolePreview(null)
      return
    }
    setVaultRolePreview(previewRole, previewTargets)
  }, [previewRole, previewTargets])

  useEffect(() => {
    return () => {
      setVaultRolePreview(null)
    }
  }, [])

  const retryPermissionCheck = useCallback(() => {
    setClassificationError(null)
    setRetryNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (freeze) {
      setLoading(false)
      return
    }
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
          classifyAllocatorVaultActionOnChain(
            provider,
            summary.vault,
            account,
            overview,
            summary.ownerKind,
            summary.curatorKind
          ),
          classifyOwnerOrCuratorVaultActionOnChain(
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
        if (cancelled || isExpectedNetworkSwitchError(e)) {
          return
        }
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
  }, [enabled, freeze, summary, provider, account, retryNonce])

  const value = useMemo((): VaultPermissionsContextValue => {
    const active = Boolean(summary && account && (enabled || freeze))
    const previewing = active && previewRole != null && previewTargets != null
    const previewAuths =
      previewRole != null && previewTargets != null
        ? authoritiesForVaultRolePreview(previewRole, previewTargets)
        : null
    const permissionsReady = previewing
      ? true
      : Boolean(
          active &&
            !loading &&
            classificationError == null &&
            allocatorAuth != null &&
            ownerCuratorAuth != null
        )
    const canAllocator = previewing
      ? previewAuths!.allocator.mode !== 'denied'
      : permissionsReady && allocatorAuth!.mode !== 'denied'
    const canOwnerOrCurator = previewing
      ? previewAuths!.ownerCurator.mode !== 'denied'
      : permissionsReady && ownerCuratorAuth!.mode !== 'denied'
    return {
      active,
      loading: previewing ? false : loading,
      classificationError: previewing ? null : classificationError,
      retryPermissionCheck,
      permissionsReady,
      allocatorAuth: previewing ? previewAuths!.allocator : allocatorAuth,
      ownerCuratorAuth: previewing ? previewAuths!.ownerCurator : ownerCuratorAuth,
      canAllocator,
      canOwnerOrCurator,
      previewRole,
      setPreviewRole,
      clearPreviewRole,
    }
  }, [
    enabled,
    freeze,
    summary,
    account,
    loading,
    classificationError,
    retryPermissionCheck,
    allocatorAuth,
    ownerCuratorAuth,
    previewRole,
    previewTargets,
    setPreviewRole,
    clearPreviewRole,
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
