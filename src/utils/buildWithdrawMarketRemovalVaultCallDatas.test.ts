import { describe, it, expect } from 'vitest'
import { Interface, getAddress } from 'ethers'
import { buildWithdrawMarketRemovalVaultCallDatas } from './reallocateRemoveWithdrawMarket'

describe('buildWithdrawMarketRemovalVaultCallDatas', () => {
  it('emits only updateWithdrawQueue when no realloc, no submitCap, no supply queue change', () => {
    const removed = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const iface = new Interface(['function updateWithdrawQueue(uint256[] _indexes)'])
    const updateSel = iface.getFunction('updateWithdrawQueue')!.selector

    const datas = buildWithdrawMarketRemovalVaultCallDatas({
      allocations: null,
      removedMarket: removed,
      newQueueIndexes: [BigInt(0), BigInt(1)],
      includeSubmitCapZero: false,
    })

    expect(datas).toHaveLength(1)
    expect(datas[0]!.startsWith(updateSel)).toBe(true)
  })
})
