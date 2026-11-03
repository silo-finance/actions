import { Interface } from 'ethers'
import { describe, expect, it } from 'vitest'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import {
  buildSubmitMarketRemovalPreview,
  buildSubmitMarketRemovalVaultCallDatas,
  classifyUpdateWithdrawQueueRemoval,
  describeUpdateWithdrawQueueFailure,
  describeUpdateWithdrawQueueRemoval,
} from '@/utils/submitMarketRemovalBatch'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))
const NOW = BigInt(1_700_000_000)
const MARKET = '0x1111111111111111111111111111111111111111'

function state(partial: Partial<WithdrawMarketOnchainState> = {}): WithdrawMarketOnchainState {
  return {
    address: MARKET,
    supplyShares: BigInt(0),
    supplyAssets: BigInt(0),
    cap: BigInt(0),
    enabled: true,
    pendingCapValue: BigInt(0),
    pendingCapValidAt: BigInt(0),
    removableAt: NOW - BigInt(1),
    ...partial,
  }
}

describe('classifyUpdateWithdrawQueueRemoval', () => {
  it('is ready after the forced-removal timelock, including when the vault still has supply', () => {
    expect(classifyUpdateWithdrawQueueRemoval(state(), NOW)).toEqual({ kind: 'ready', hasSupply: false })
    expect(classifyUpdateWithdrawQueueRemoval(state({ supplyShares: BigInt(5) }), NOW)).toEqual({
      kind: 'ready',
      hasSupply: true,
    })
  })

  it('blocks markets with no pending removal', () => {
    const blocked = state({ removableAt: BigInt(0), cap: BigInt(100) })
    expect(classifyUpdateWithdrawQueueRemoval(blocked, NOW)).toEqual({
      kind: 'blocked',
      reasons: ['no_pending_removal'],
    })
    expect(describeUpdateWithdrawQueueRemoval(blocked, NOW)).toBe(
      'No pending market removal. Submit Market Removal first.'
    )
  })

  it('reports the remaining timelock and refuses a zero clock', () => {
    const pending = state({ removableAt: NOW + BigInt(90) })
    expect(classifyUpdateWithdrawQueueRemoval(pending, NOW).kind).toBe('blocked')
    expect(describeUpdateWithdrawQueueRemoval(pending, NOW)).toBe('Removable in 1m.')
    expect(describeUpdateWithdrawQueueRemoval(pending, null)).toBe('Checking the removal timelock…')
  })

  it('blocks an elapsed removal when the cap is still set or a cap change is pending', () => {
    expect(describeUpdateWithdrawQueueRemoval(state({ cap: BigInt(1) }), NOW)).toBe(
      'Supply cap is not zero, so updateWithdrawQueue cannot remove this market.'
    )
    expect(describeUpdateWithdrawQueueRemoval(state({ pendingCapValidAt: NOW + BigInt(10) }), NOW)).toBe(
      'A pending cap change blocks removal. Revoke or accept it first.'
    )
  })
})

describe('updateWithdrawQueue calldata', () => {
  it('keeps every queue index except the selected elapsed markets', () => {
    const queue = [
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
    ]
    const selected = [{ address: queue[1]!, cap: BigInt(0), mode: 'finalize' as const }]
    const preview = buildSubmitMarketRemovalPreview({ withdrawQueue: queue, selected })
    expect(preview).toEqual([
      {
        id: 'updateWithdrawQueue',
        method: 'updateWithdrawQueue',
        argLabel: '_indexes (uint256[])',
        copyValue: '[0, 2]',
      },
    ])

    const datas = buildSubmitMarketRemovalVaultCallDatas({ withdrawQueue: queue, selected })
    expect(datas).toHaveLength(1)
    const decoded = vaultIface.decodeFunctionData('updateWithdrawQueue', datas[0]!)
    expect(Array.from(decoded[0] as bigint[])).toEqual([BigInt(0), BigInt(2)])
  })
})

describe('describeUpdateWithdrawQueueFailure', () => {
  it('maps forced-removal reverts to short hints', () => {
    const cases: { name: string; args: unknown[]; hint: string }[] = [
      {
        name: 'InvalidMarketRemovalNonZeroCap',
        args: [MARKET],
        hint: 'This market still has a non-zero supply cap, so updateWithdrawQueue cannot remove it.',
      },
      {
        name: 'PendingCap',
        args: [MARKET],
        hint: 'A pending cap change blocks updateWithdrawQueue. Revoke or accept it first.',
      },
      {
        name: 'InvalidMarketRemovalNonZeroSupply',
        args: [MARKET],
        hint: 'The vault still holds this market and no removal timelock has elapsed.',
      },
      {
        name: 'InvalidMarketRemovalTimelockNotElapsed',
        args: [MARKET],
        hint: 'The removal timelock has not elapsed yet.',
      },
      {
        name: 'NotAllocatorRole',
        args: [],
        hint: 'This wallet is not an owner, curator, or allocator of the vault.',
      },
    ]
    for (const row of cases) {
      const data = vaultIface.encodeErrorResult(row.name, row.args)
      expect(describeUpdateWithdrawQueueFailure({ data })).toBe(row.hint)
    }
  })

  it('keeps wallet rejection copy', () => {
    expect(describeUpdateWithdrawQueueFailure({ code: 4001, message: 'user rejected' })).toBe(
      'Transaction rejected in wallet.'
    )
  })
})
