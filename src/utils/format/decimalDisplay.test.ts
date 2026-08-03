import { describe, expect, it } from 'vitest'
import {
  applyFractionPadding,
  getDecimalSeparator,
  splitFormattedDecimal,
} from '@/utils/format/decimalDisplay'

describe('splitFormattedDecimal', () => {
  it('splits a grouped value with a fractional part (en-US)', () => {
    expect(splitFormattedDecimal('1,234.56', 'en-US')).toEqual({
      integer: '1,234',
      fraction: '.56',
      suffix: '',
    })
  })

  it('leaves grouping-only integers intact (en-US)', () => {
    expect(splitFormattedDecimal('1,234', 'en-US')).toEqual({
      integer: '1,234',
      fraction: null,
      suffix: '',
    })
  })

  it('splits percent suffix values', () => {
    expect(splitFormattedDecimal('12.34%', 'en-US')).toEqual({
      integer: '12',
      fraction: '.34',
      suffix: '%',
    })
  })

  it('splits EU-style decimals using the locale decimal separator', () => {
    expect(splitFormattedDecimal('1.234,56', 'de-DE')).toEqual({
      integer: '1.234',
      fraction: ',56',
      suffix: '',
    })
  })

  it('passes through sentinels unchanged', () => {
    expect(splitFormattedDecimal('—')).toEqual({
      integer: '—',
      fraction: null,
      suffix: '',
    })
    expect(splitFormattedDecimal('N/A')).toEqual({
      integer: 'N/A',
      fraction: null,
      suffix: '',
    })
  })

  it('splits three-digit fractions without mistaking them for thousands grouping', () => {
    expect(splitFormattedDecimal('0.001', 'en-US')).toEqual({
      integer: '0',
      fraction: '.001',
      suffix: '',
    })
    expect(splitFormattedDecimal('1.234', 'en-US')).toEqual({
      integer: '1',
      fraction: '.234',
      suffix: '',
    })
    expect(splitFormattedDecimal('5.678', 'en-US')).toEqual({
      integer: '5',
      fraction: '.678',
      suffix: '',
    })
  })

  it('splits single-digit fractions', () => {
    expect(splitFormattedDecimal('1.2', 'en-US')).toEqual({
      integer: '1',
      fraction: '.2',
      suffix: '',
    })
  })

  it('splits large grouped amounts with three fraction digits', () => {
    expect(splitFormattedDecimal('1,234,567.891', 'en-US')).toEqual({
      integer: '1,234,567',
      fraction: '.891',
      suffix: '',
    })
  })

  it('uses the runtime decimal separator by default', () => {
    const sep = getDecimalSeparator()
    const formatted = `12${sep}34`
    expect(splitFormattedDecimal(formatted)).toEqual({
      integer: '12',
      fraction: `${sep}34`,
      suffix: '',
    })
  })
})

describe('applyFractionPadding', () => {
  it('pads whole numbers to the configured width', () => {
    expect(applyFractionPadding(splitFormattedDecimal('12', 'en-US'), 2, 'en-US')).toEqual({
      integer: '12',
      fraction: '.00',
      suffix: '',
    })
  })

  it('pads partial fractions without truncating longer values', () => {
    expect(applyFractionPadding(splitFormattedDecimal('2.2', 'en-US'), 2, 'en-US')).toEqual({
      integer: '2',
      fraction: '.20',
      suffix: '',
    })
    expect(applyFractionPadding(splitFormattedDecimal('0.0012', 'en-US'), 2, 'en-US')).toEqual({
      integer: '0',
      fraction: '.0012',
      suffix: '',
    })
  })
})
