import { describe, expect, it } from 'vitest'
import { buildLiquidationSnapshotKey } from '@/utils/liquidationSnapshot'

describe('buildLiquidationSnapshotKey', () => {
  it('returns a stable 16-char hex fingerprint for the same entries', () => {
    const entries = [
      { chainId: 1, siloAddress: '0xAbC0000000000000000000000000000000000001' },
      { chainId: 42161, siloAddress: '0xdef0000000000000000000000000000000000002' },
    ]
    const first = buildLiquidationSnapshotKey(entries)
    const second = buildLiquidationSnapshotKey(entries)
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(first).toBe(second)
  })

  it('is case-insensitive for silo addresses', () => {
    const lower = buildLiquidationSnapshotKey([
      { chainId: 1, siloAddress: '0xabc0000000000000000000000000000000000001' },
    ])
    const mixed = buildLiquidationSnapshotKey([
      { chainId: 1, siloAddress: '0xAbC0000000000000000000000000000000000001' },
    ])
    expect(lower).toBe(mixed)
  })

  it('changes when the market set or order changes', () => {
    const a = buildLiquidationSnapshotKey([
      { chainId: 1, siloAddress: '0xabc0000000000000000000000000000000000001' },
      { chainId: 42161, siloAddress: '0xdef0000000000000000000000000000000000002' },
    ])
    const b = buildLiquidationSnapshotKey([
      { chainId: 42161, siloAddress: '0xdef0000000000000000000000000000000000002' },
      { chainId: 1, siloAddress: '0xabc0000000000000000000000000000000000001' },
    ])
    const c = buildLiquidationSnapshotKey([
      { chainId: 1, siloAddress: '0xabc0000000000000000000000000000000000001' },
    ])
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })
})
