import { describe, expect, it } from 'vitest'
import { resolveSiloMarketRole } from '@/utils/siloMarketRole'

const NON_ZERO = '740000000000000000'
const ZERO = '0'

describe('resolveSiloMarketRole', () => {
  it('returns collateral when this LT > 0 and other LT = 0', () => {
    expect(resolveSiloMarketRole(NON_ZERO, ZERO)).toBe('collateral')
  })

  it('returns debt when this LT = 0 and other LT > 0', () => {
    expect(resolveSiloMarketRole(ZERO, NON_ZERO)).toBe('debt')
  })

  it('returns two-way when both LTs > 0', () => {
    expect(resolveSiloMarketRole(NON_ZERO, '950000000000000000')).toBe('two-way')
  })

  it('returns null when both LTs are zero', () => {
    expect(resolveSiloMarketRole(ZERO, ZERO)).toBeNull()
  })

  it('returns null when either LT is missing', () => {
    expect(resolveSiloMarketRole(NON_ZERO, null)).toBeNull()
    expect(resolveSiloMarketRole(null, NON_ZERO)).toBeNull()
    expect(resolveSiloMarketRole(null, null)).toBeNull()
  })
})
