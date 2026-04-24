import { describe, expect, it } from 'vitest'
import { flatRateCalculationPreview, parseHumanPercentInput, SECONDS_IN_YEAR, WAD } from '@/utils/flatIrmRate'

describe('parseHumanPercentInput', () => {
  it('accepts comma decimals', () => {
    expect(parseHumanPercentInput('0,2')).toBe(0.2)
    expect(parseHumanPercentInput('5,07')).toBe(5.07)
  })
})

describe('flatRateCalculationPreview', () => {
  it('uses integer division of annual wad by seconds in year for rmin', () => {
    const p = 2
    const { annualRateWad, rmin } = flatRateCalculationPreview(p)
    expect(annualRateWad).toBe(
      BigInt(Math.round(0.02 * Number(WAD)))
    )
    expect(rmin).toBe(annualRateWad / SECONDS_IN_YEAR)
  })
})
