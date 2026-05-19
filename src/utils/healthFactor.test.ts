import { describe, expect, it } from 'vitest'
import { computeHealthFactor, MAX_HEALTH_FACTOR } from '@/utils/healthFactor'

describe('computeHealthFactor', () => {
  it('uses ltv/lt at or below liquidation threshold', () => {
    expect(computeHealthFactor(0.4, 0.8)).toBe(0.5)
    expect(computeHealthFactor(0.8, 0.8)).toBe(1)
  })

  it('maps excess ltv above lt into 1..2 range', () => {
    // LT 80%, user 85% -> 5% of 20% room -> HF 1.25
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
