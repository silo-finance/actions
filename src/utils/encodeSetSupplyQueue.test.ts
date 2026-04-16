import { describe, it, expect } from 'vitest'
import { Interface } from 'ethers'
import { encodeSetSupplyQueueEmpty } from './encodeSetSupplyQueue'

describe('encodeSetSupplyQueueEmpty', () => {
  it('encodes setSupplyQueue([]) with stable selector', () => {
    const data = encodeSetSupplyQueueEmpty()
    const iface = new Interface(['function setSupplyQueue(address[] _newSupplyQueue)'])
    const expectedSelector = iface.getFunction('setSupplyQueue')!.selector
    expect(data.startsWith(expectedSelector)).toBe(true)
    expect(data).toMatch(/^0x[0-9a-f]+$/i)
    expect(data.length).toBeGreaterThan(10)
  })
})
