import { describe, it, expect, afterEach, vi } from 'vitest'
import { JsonRpcProvider } from 'ethers'
import { classifyAllocatorVaultAction, classifyOwnerOrCuratorVaultAction } from './vaultActionAuthority'
import {
  authoritiesForVaultRolePreview,
  getVaultRolePreview,
  setVaultRolePreview,
  type VaultPreviewTargets,
} from './vaultRolePreview'

const provider = new JsonRpcProvider('http://127.0.0.1:65535')
const vault = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const owner = '0x1111111111111111111111111111111111111111'
const curator = '0x2222222222222222222222222222222222222222'
const stranger = '0x3333333333333333333333333333333333333333'

const eoaTargets: VaultPreviewTargets = {
  owner,
  curator,
  ownerKind: 'eoa',
  curatorKind: 'eoa',
}
const safeTargets: VaultPreviewTargets = {
  owner,
  curator,
  ownerKind: 'safe',
  curatorKind: 'safe',
}

const DIRECT = { mode: 'direct', executingSafeAddress: null }
const DENIED = { mode: 'denied', executingSafeAddress: null }
const ownerSafe = { mode: 'safe_as_wallet', executingSafeAddress: owner }
const curatorSafe = { mode: 'safe_as_wallet', executingSafeAddress: curator }

describe('authoritiesForVaultRolePreview', () => {
  it('treats an EOA owner or curator as a direct wallet', () => {
    for (const role of ['owner', 'curator'] as const) {
      expect(authoritiesForVaultRolePreview(role, eoaTargets)).toEqual({
        allocator: DIRECT,
        ownerCurator: DIRECT,
      })
    }
  })

  it('treats a Safe owner as that Safe for allocator and owner actions', () => {
    expect(authoritiesForVaultRolePreview('owner', safeTargets)).toEqual({
      allocator: ownerSafe,
      ownerCurator: ownerSafe,
    })
  })

  it('treats a Safe curator as that Safe, even when the owner is an EOA', () => {
    expect(
      authoritiesForVaultRolePreview('curator', {
        ...eoaTargets,
        curatorKind: 'safe',
      })
    ).toEqual({
      allocator: curatorSafe,
      ownerCurator: curatorSafe,
    })
  })

  it('treats allocator as direct only for allocator actions', () => {
    expect(authoritiesForVaultRolePreview('allocator', safeTargets)).toEqual({
      allocator: DIRECT,
      ownerCurator: DENIED,
    })
  })

  it('treats guardian and none as denied', () => {
    for (const role of ['guardian', 'none'] as const) {
      expect(authoritiesForVaultRolePreview(role, safeTargets)).toEqual({
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

  it('returns the Safe preview authority and skips chain reads', async () => {
    const call = vi.spyOn(provider, 'call')
    setVaultRolePreview('owner', safeTargets)

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

    expect(allocator).toEqual(ownerSafe)
    expect(ownerCurator).toEqual(ownerSafe)
    expect(call).not.toHaveBeenCalled()
  })

  it('returns denied for none without a chain read', async () => {
    const call = vi.spyOn(provider, 'call')
    setVaultRolePreview('none', eoaTargets)

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
    setVaultRolePreview('none', eoaTargets)
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
