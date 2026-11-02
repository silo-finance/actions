import { Interface } from 'ethers'
import { describe, expect, it } from 'vitest'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import { describeVaultRevert } from '@/utils/vaultCallRevert'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))

describe('describeVaultRevert', () => {
  it('reads a vault custom error from revert data', () => {
    const data = vaultIface.encodeErrorResult('NotAllocatorRole', [])
    expect(describeVaultRevert({ data })).toBe('NotAllocatorRole')
  })

  it('includes custom-error arguments', () => {
    const market = '0x1111111111111111111111111111111111111111'
    const data = vaultIface.encodeErrorResult('UnauthorizedMarket', [market])
    expect(describeVaultRevert({ data })).toBe(`UnauthorizedMarket(${market})`)
  })

  it('reads Error(string) and an ethers revert name', () => {
    const errorIface = new Interface(['error Error(string message)'])
    const data = errorIface.encodeErrorResult('Error', ['not an owner'])
    expect(describeVaultRevert({ data })).toBe('not an owner')
    expect(describeVaultRevert({ revert: { name: 'NotCuratorRole', args: [] } })).toBe('NotCuratorRole')
  })
})
