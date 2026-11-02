import type { VaultActionAuthority } from '@/utils/vaultActionAuthority'

/** Virtual vault role used only to exercise the vault page UI. */
export const VAULT_PREVIEW_ROLES = ['owner', 'curator', 'allocator', 'guardian', 'none'] as const

export type VaultPreviewRole = (typeof VAULT_PREVIEW_ROLES)[number]

export type VaultPreviewAuthorityKind = 'allocator' | 'ownerCurator'

export type VaultPreviewAuthorities = Record<VaultPreviewAuthorityKind, VaultActionAuthority>

const DIRECT: VaultActionAuthority = { mode: 'direct', executingSafeAddress: null }
const DENIED: VaultActionAuthority = { mode: 'denied', executingSafeAddress: null }

/**
 * Module state so send-time `classify*` calls see the same choice as the React context.
 * Preview always resolves to `direct` or `denied` and never opens a Safe proposal.
 */
let previewRole: VaultPreviewRole | null = null

export function isVaultPreviewRole(value: string): value is VaultPreviewRole {
  return (VAULT_PREVIEW_ROLES as readonly string[]).includes(value)
}

export function getVaultRolePreview(): VaultPreviewRole | null {
  return previewRole
}

export function setVaultRolePreview(role: VaultPreviewRole | null): void {
  previewRole = role
}

/** Authorities the vault UI and pre-send role gate should use for a preview role. */
export function authoritiesForVaultRolePreview(role: VaultPreviewRole): VaultPreviewAuthorities {
  switch (role) {
    case 'owner':
    case 'curator':
      return { allocator: DIRECT, ownerCurator: DIRECT }
    case 'allocator':
      return { allocator: DIRECT, ownerCurator: DENIED }
    case 'guardian':
    case 'none':
      return { allocator: DENIED, ownerCurator: DENIED }
  }
}

/** Active preview authority, or null when the real on-chain role should be used. */
export function vaultRolePreviewAuthority(kind: VaultPreviewAuthorityKind): VaultActionAuthority | null {
  if (previewRole == null) return null
  return authoritiesForVaultRolePreview(previewRole)[kind]
}
