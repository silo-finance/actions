import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { sortDestinationsByHeadroomDesc } from './reallocateRemoveWithdrawMarket'

describe('sortDestinationsByHeadroomDesc', () => {
  it('orders markets by supply headroom descending', () => {
    const a = getAddress('0x1000000000000000000000000000000000000001')
    const b = getAddress('0x2000000000000000000000000000000000000002')
    const supply = new Map<string, bigint>([
      [a, BigInt(100)],
      [b, BigInt(50)],
    ])
    const cap = new Map<string, bigint>([
      [a, BigInt(200)], // headroom 100
      [b, BigInt(300)], // headroom 250
    ])
    const out = sortDestinationsByHeadroomDesc([a, b], supply, cap)
    expect(out).toEqual([b, a])
  })
})
