import { describe, expect, it } from 'vitest'
import {
  computeHealthFactor,
  computePositionPriority,
  MAX_HEALTH_FACTOR,
  positionRiskSortTier,
  priorityFilledTickCount,
  resolvePositionPriorityScaleByTier,
  resolveTrimmedPriorityScale,
} from '@/utils/healthFactor'

describe('computeHealthFactor', () => {
  it('uses ltv/lt at or below liquidation threshold', () => {
    expect(computeHealthFactor(0.4, 0.8)).toBe(0.5)
    expect(computeHealthFactor(0.8, 0.8)).toBe(1)
  })

  it('maps excess ltv above lt into 1..2 range', () => {
    expect(computeHealthFactor(0.85, 0.8)).toBeCloseTo(1.25, 10)
  })

  it('caps at 2 when user ltv reaches 100%', () => {
    expect(computeHealthFactor(1, 0.8)).toBe(MAX_HEALTH_FACTOR)
    expect(computeHealthFactor(1.2, 0.8)).toBe(MAX_HEALTH_FACTOR)
  })

  it('returns null when lt is missing or invalid', () => {
    expect(computeHealthFactor(0.5, null)).toBeNull()
    expect(computeHealthFactor(0.5, 0)).toBeNull()
  })
})

describe('computePositionPriority', () => {
  it('multiplies debt value by health factor', () => {
    expect(computePositionPriority(1000, 1.25)).toBe(1250)
  })
})

describe('positionRiskSortTier', () => {
  it('orders insolvent before warning before normal', () => {
    expect(positionRiskSortTier(true, true)).toBeLessThan(positionRiskSortTier(false, true))
    expect(positionRiskSortTier(false, true)).toBeLessThan(positionRiskSortTier(false, false))
  })
})

describe('resolveTrimmedPriorityScale', () => {
  it('uses raw min/max when three or fewer samples', () => {
    expect(resolveTrimmedPriorityScale([5, 10, 20])).toEqual({ min: 5, max: 20 })
  })

  it('trims bottom and top 1% by rounded-up count when four or more samples', () => {
    const values = Array.from({ length: 100 }, (_, index) => index)
    expect(resolveTrimmedPriorityScale(values)).toEqual({ min: 1, max: 98 })
  })

  it('trims at least one value from each side for small tiers >= 4', () => {
    expect(resolveTrimmedPriorityScale([10, 20, 30, 40])).toEqual({ min: 20, max: 30 })
  })
})

describe('priorityFilledTickCount', () => {
  it('maps scale min to zero ticks and scale max to all ticks', () => {
    const { min, max } = resolveTrimmedPriorityScale([0, 50, 100])
    expect(priorityFilledTickCount(0, min, max)).toBe(0)
    expect(priorityFilledTickCount(100, min, max)).toBe(10)
  })

  it('gives at least one tick above scale min', () => {
    const { min, max } = resolveTrimmedPriorityScale([0, 50, 100])
    expect(priorityFilledTickCount(1, min, max)).toBe(1)
    expect(priorityFilledTickCount(50, min, max)).toBeGreaterThanOrEqual(1)
  })
})

describe('resolvePositionPriorityScaleByTier', () => {
  it('builds independent trimmed min/max per risk tier', () => {
    const scales = resolvePositionPriorityScaleByTier([
      { priority: 10, isInsolvent: true, isWarning: false },
      { priority: 100, isInsolvent: true, isWarning: false },
      { priority: 1, isInsolvent: false, isWarning: true },
      { priority: 5, isInsolvent: false, isWarning: true },
      { priority: 50, isInsolvent: false, isWarning: false },
      { priority: 200, isInsolvent: false, isWarning: false },
    ])
    expect(scales.insolvent).toEqual({ min: 10, max: 100 })
    expect(scales.warning).toEqual({ min: 1, max: 5 })
    expect(scales.normal).toEqual({ min: 50, max: 200 })
  })
})
