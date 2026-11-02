import type { VaultActionAuthority } from '@/utils/vaultActionAuthority'
import type { OwnerKind } from '@/utils/ownerKind'

/** Virtual vault role used only to exercise the vault page UI. */
export const VAULT_PREVIEW_ROLES = ['owner', 'curator', 'allocator', 'guardian', 'none'] as const

export type VaultPreviewRole = (typeof VAULT_PREVIEW_ROLES)[number]

export type VaultPreviewAuthorityKind = 'allocator' | 'ownerCurator'

export type VaultPreviewAuthorities = Record<VaultPreviewAuthorityKind, VaultActionAuthority>

/** On-chain owner and curator the preview is standing in for. */
export type VaultPreviewTargets = {
  owner: string
  curator: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
}

const DIRECT: VaultActionAuthority = { mode: 'direct', executingSafeAddress: null }
const DENIED: VaultActionAuthority = { mode: 'denied', executingSafeAddress: null }

type ActivePreview = {
  role: VaultPreviewRole
  targets: VaultPreviewTargets
}

/**
 * Module state so send-time `classify*` calls see the same choice as the React context.
 * A Safe owner or curator is previewed as that Safe wallet (`safe_as_wallet`), not as an EOA.
 */
let preview: ActivePreview | null = null

export function isVaultPreviewRole(value: string): value is VaultPreviewRole {
  return (VAULT_PREVIEW_ROLES as readonly string[]).includes(value)
}

export function getVaultRolePreview(): VaultPreviewRole | null {
  return preview?.role ?? null
}

export function setVaultRolePreview(role: VaultPreviewRole | null, targets?: VaultPreviewTargets): void {
  if (role == null || targets == null) {
    preview = null
    return
  }
  preview = { role, targets }
}

/** Wallet path for standing in as `address` when that address is a Gnosis Safe or an EOA. */
function authorityForRoleAddress(kind: OwnerKind, address: string): VaultActionAuthority {
  if (kind === 'safe') return { mode: 'safe_as_wallet', executingSafeAddress: address }
  return DIRECT
}

/** Authorities the vault UI and pre-send role gate should use for a preview role. */
export function authoritiesForVaultRolePreview(
  role: VaultPreviewRole,
  targets: VaultPreviewTargets
): VaultPreviewAuthorities {
  switch (role) {
    case 'owner': {
      const asOwner = authorityForRoleAddress(targets.ownerKind, targets.owner)
      return { allocator: asOwner, ownerCurator: asOwner }
    }
    case 'curator': {
      const asCurator = authorityForRoleAddress(targets.curatorKind, targets.curator)
      return { allocator: asCurator, ownerCurator: asCurator }
    }
    case 'allocator':
      return { allocator: DIRECT, ownerCurator: DENIED }
    case 'guardian':
    case 'none':
      return { allocator: DENIED, ownerCurator: DENIED }
  }
}

/** Active preview authority, or null when the real on-chain role should be used. */
export function vaultRolePreviewAuthority(kind: VaultPreviewAuthorityKind): VaultActionAuthority | null {
  if (preview == null) return null
  return authoritiesForVaultRolePreview(preview.role, preview.targets)[kind]
}
