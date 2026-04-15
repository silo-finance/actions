import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JsonRpcProvider } from 'ethers'
import { classifyAllocatorVaultAction, classifyOwnerOrCuratorVaultAction } from './vaultActionAuthority'
import * as safeOwnerList from './safeOwnerList'

const provider = new JsonRpcProvider('http://127.0.0.1:65535')
const vault = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const owner = '0x1111111111111111111111111111111111111111'
const curator = '0x2222222222222222222222222222222222222222'
const signer = '0x3333333333333333333333333333333333333333'

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

  it('returns safe_propose when owner is Safe and connected account equals owner (WalletConnect / smart wallet)', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      owner,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_propose', executingSafeAddress: owner })
  })

  it('returns safe_propose when curator is Safe and connected account equals curator', async () => {
    const r = await classifyOwnerOrCuratorVaultAction(
      provider,
      curator,
      { owner, curator },
      'eoa',
      'safe'
    )
    expect(r).toEqual({ mode: 'safe_propose', executingSafeAddress: curator })
  })

  it('returns safe_propose when owner is Safe and connected signer is Safe owner', async () => {
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
})

describe('classifyAllocatorVaultAction', () => {
  beforeEach(() => {
    vi.spyOn(safeOwnerList, 'isAddressSafeOwner').mockResolvedValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns safe_propose when owner is Safe and connected account equals owner before allocator checks', async () => {
    const r = await classifyAllocatorVaultAction(
      provider,
      vault,
      owner,
      { owner, curator },
      'safe',
      'eoa'
    )
    expect(r).toEqual({ mode: 'safe_propose', executingSafeAddress: owner })
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
})
