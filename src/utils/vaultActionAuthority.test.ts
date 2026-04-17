import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JsonRpcProvider } from 'ethers'
import { classifyAllocatorVaultAction, classifyOwnerOrCuratorVaultAction } from './vaultActionAuthority'
import * as safeOwnerList from './safeOwnerList'

const provider = new JsonRpcProvider('http://127.0.0.1:65535')
const vault = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const owner = '0x1111111111111111111111111111111111111111'
const curator = '0x2222222222222222222222222222222222222222'
const signer = '0x3333333333333333333333333333333333333333'

const ABI_FALSE = '0x' + '0'.repeat(64)
const ABI_TRUE = '0x' + '0'.repeat(63) + '1'

function stubIsAllocator(value: boolean) {
  vi.spyOn(provider, 'call').mockResolvedValue(value ? ABI_TRUE : ABI_FALSE)
}

describe('classifyOwnerOrCuratorVaultAction', () => {
  beforeEach(() => {
    vi.spyOn(safeOwnerList, 'isAddressSafeOwner').mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns direct when owner is EOA and connected as owner', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      owner,
      { owner, curator },
      'eoa',
      'eoa'
    )
    expect(r).toEqual({ mode: 'direct', executingSafeAddress: null })
  })

  it('returns safe_as_wallet when owner is Safe and connected account equals owner (WC from Safe{Wallet} / Safe Apps iframe / impersonate)', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      owner,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_as_wallet', executingSafeAddress: owner })
  })

  it('returns safe_as_wallet when curator is Safe and connected account equals curator', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      curator,
      { owner, curator },
      'eoa',
      'safe'
    )
    expect(r).toEqual({ mode: 'safe_as_wallet', executingSafeAddress: curator })
  })

  it('returns safe_propose when owner is Safe and connected signer is a separate Safe owner EOA', async () => {
    vi.spyOn(safeOwnerList, 'isAddressSafeOwner').mockImplementation(async (_p, safeAddr, addr) => {
      return safeAddr.toLowerCase() === owner.toLowerCase() && addr.toLowerCase() === signer.toLowerCase()
    })
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      signer,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_propose', executingSafeAddress: owner })
  })

  it('returns denied when EOA is neither owner/curator nor a Safe owner', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      signer,
      { owner, curator },
      'safe',
      'safe'
    )
    expect(r).toEqual({ mode: 'denied', executingSafeAddress: null })
  })
})

describe('classifyAllocatorVaultAction', () => {
  beforeEach(() => {
    vi.spyOn(safeOwnerList, 'isAddressSafeOwner').mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns safe_as_wallet when owner is Safe and connected account equals owner before allocator checks', async () => {
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      owner,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_as_wallet', executingSafeAddress: owner })
  })

  it('returns direct when owner is EOA and connected as owner', async () => {
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      owner,
      { owner, curator },
      'eoa',
      'eoa'
    )
    expect(r).toEqual({ mode: 'direct', executingSafeAddress: null })
  })

  it('returns direct when EOA is marked as allocator on the vault', async () => {
    stubIsAllocator(true)
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      signer,
      { owner, curator },
      'eoa',
      'eoa'
    )
    expect(r).toEqual({ mode: 'direct', executingSafeAddress: null })
  })

  it('returns safe_propose when ownerKind=safe and connected EOA is a Safe owner', async () => {
    stubIsAllocator(false)
    vi.spyOn(safeOwnerList, 'isAddressSafeOwner').mockImplementation(async (_p, safeAddr, addr) => {
      return safeAddr.toLowerCase() === owner.toLowerCase() && addr.toLowerCase() === signer.toLowerCase()
    })
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      signer,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_propose', executingSafeAddress: owner })
  })

  it('returns denied when EOA is not allocator and not a Safe owner', async () => {
    stubIsAllocator(false)
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      signer,
      { owner, curator },
      'safe',
      'safe'
    )
    expect(r).toEqual({ mode: 'denied', executingSafeAddress: null })
  })
})
