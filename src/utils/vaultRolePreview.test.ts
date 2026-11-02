import { describe, it, expect, afterEach, vi } from 'vitest'
import { JsonRpcProvider } from 'ethers'
import { classifyAllocatorVaultAction, classifyOwnerOrCuratorVaultAction } from './vaultActionAuthority'
import {
  authoritiesForVaultRolePreview,
  getVaultRolePreview,
  setVaultRolePreview,
  type VaultPreviewRole,
} from './vaultRolePreview'

const provider = new JsonRpcProvider('http://127.0.0.1:65535')
const vault = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const owner = '0x1111111111111111111111111111111111111111'
const curator = '0x2222222222222222222222222222222222222222'
const stranger = '0x3333333333333333333333333333333333333333'

const DIRECT = { mode: 'direct', executingSafeAddress: null }
const DENIED = { mode: 'denied', executingSafeAddress: null }

describe('authoritiesForVaultRolePreview', () => {
  it('treats owner and curator as direct for allocator and owner/curator actions', () => {
    for (const role of ['owner', 'curator'] as const) {
      expect(authoritiesForVaultRolePreview(role)).toEqual({
        allocator: DIRECT,
        ownerCurator: DIRECT,
      })
    }
  })

  it('treats allocator as direct only for allocator actions', () => {
    expect(authoritiesForVaultRolePreview('allocator')).toEqual({
      allocator: DIRECT,
      ownerCurator: DENIED,
    })
  })

  it('treats guardian and none as denied', () => {
    for (const role of ['guardian', 'none'] as const) {
      expect(authoritiesForVaultRolePreview(role)).toEqual({
        allocator: DENIED,
        ownerCurator: DENIED,
      })
    }
  })
})

describe('classify functions with a role preview', () => {
  afterEach(() => {
    setVaultRolePreview(null)
    vi.restoreAllMocks()
  })

  it('returns the preview authority and skips chain reads', async () => {
    const call = vi.spyOn(provider, 'call')
    setVaultRolePreview('owner')

    const allocator = await classifyAllocatorVaultAction(
      provider,
      vault,
      stranger,
      { owner, curator },
      'eoa',
      'eoa'
    )
    const ownerCurator = await classifyOwnerOrCuratorVaultAction(
      provider,
      stranger,
      { owner, curator },
      'eoa',
      'eoa'
    )

    expect(allocator).toEqual(DIRECT)
    expect(ownerCurator).toEqual(DIRECT)
    expect(call).not.toHaveBeenCalled()
  })

  it('returns denied for none without a chain read', async () => {
    const call = vi.spyOn(provider, 'call')
    setVaultRolePreview('none')

    const allocator = await classifyAllocatorVaultAction(
      provider,
      vault,
      owner,
      { owner, curator },
      'eoa',
      'eoa'
    )

    expect(allocator).toEqual(DENIED)
    expect(call).not.toHaveBeenCalled()
  })

  it('uses the chain result again after clear', async () => {
    setVaultRolePreview('none')
    setVaultRolePreview(null)
    expect(getVaultRolePreview()).toBeNull()

    const ownerCurator = await classifyOwnerOrCuratorVaultAction(
      provider,
      owner,
      { owner, curator },
      'eoa',
      'eoa'
    )

    expect(ownerCurator).toEqual(DIRECT)
  })
})

describe('preview role coverage', () => {
  it('maps every selectable role', () => {
    const roles: VaultPreviewRole[] = ['owner', 'curator', 'allocator', 'guardian', 'none']
    for (const role of roles) {
      const auths = authoritiesForVaultRolePreview(role)
      expect(auths.allocator.mode === 'direct' || auths.allocator.mode === 'denied').toBe(true)
      expect(auths.allocator.executingSafeAddress).toBeNull()
      expect(auths.ownerCurator.executingSafeAddress).toBeNull()
    }
  })
})
