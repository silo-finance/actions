'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import {
  classifyAllocatorVaultAction,
  classifyOwnerOrCuratorVaultAction,
} from '@/utils/vaultActionAuthority'
import type { VaultActionAuthority } from '@/utils/vaultActionAuthority'

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
  const [allocatorAuth, setAllocatorAuth] = useState<VaultActionAuthority | null>(null)
  const [ownerCuratorAuth, setOwnerCuratorAuth] = useState<VaultActionAuthority | null>(null)

  useEffect(() => {
    if (!enabled || !summary || !provider || !account) {
      setAllocatorAuth(null)
      setOwnerCuratorAuth(null)
      setLoading(false)
      return
    }

    setLoading(true)
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
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, summary, provider, account])

  const value = useMemo((): VaultPermissionsContextValue => {
    const active = Boolean(enabled && summary && account)
    const canAllocator = allocatorAuth != null && allocatorAuth.mode !== 'denied'
    const canOwnerOrCurator = ownerCuratorAuth != null && ownerCuratorAuth.mode !== 'denied'
    return {
      active,
      loading,
      allocatorAuth,
      ownerCuratorAuth,
      canAllocator,
      canOwnerOrCurator,
    }
  }, [enabled, summary, account, loading, allocatorAuth, ownerCuratorAuth])

  return <VaultPermissionsContext.Provider value={value}>{children}</VaultPermissionsContext.Provider>
}

export function useVaultPermissions(): VaultPermissionsContextValue {
  const ctx = useContext(VaultPermissionsContext)
  if (ctx == null) {
    throw new Error('useVaultPermissions must be used within VaultPermissionsProvider')
  }
  return ctx
}
