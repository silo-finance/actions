import { describe, expect, it } from 'vitest'
import { resolveHotValuePositionIds, type HotValueEntry } from '@/utils/positionHotValue'

function ids(values: number[]): HotValueEntry[] {
  return values.map((value, index) => ({ id: String(index), value }))
}

describe('resolveHotValuePositionIds', () => {
  it('returns empty when fewer than two positive values', () => {
    expect(resolveHotValuePositionIds(ids([100]))).toEqual(new Set())
    expect(resolveHotValuePositionIds([])).toEqual(new Set())
  })

  it('flags top 1% when min top is at least 10× max remaining', () => {
    const values = Array.from({ length: 100 }, (_, index) => (index === 0 ? 10_000 : 10 + index))
    const hot = resolveHotValuePositionIds(ids(values))
    expect(hot).toEqual(new Set(['0']))
  })

  it('returns empty when ratio is below 10×', () => {
    const values = Array.from({ length: 100 }, (_, index) => (index === 0 ? 100 : 20 + index))
    expect(resolveHotValuePositionIds(ids(values))).toEqual(new Set())
  })

  it('includes ties at the top 1% cutoff', () => {
    const entries: HotValueEntry[] = [
      { id: 'a', value: 500 },
      { id: 'b', value: 500 },
      ...Array.from({ length: 98 }, (_, index) => ({ id: `r${index}`, value: 40 })),
    ]
    const hot = resolveHotValuePositionIds(entries)
    expect(hot).toEqual(new Set(['a', 'b']))
  })
})
