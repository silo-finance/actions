import { describe, expect, it } from 'vitest'
import { normalizeSmokeBaseUrl, resolveSmokeTargetUrl } from './smokeBaseUrl'

describe('normalizeSmokeBaseUrl', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeSmokeBaseUrl(undefined)).toBeUndefined()
    expect(normalizeSmokeBaseUrl('')).toBeUndefined()
    expect(normalizeSmokeBaseUrl('   ')).toBeUndefined()
  })

  it('keeps repository base path and appends one trailing slash', () => {
    expect(normalizeSmokeBaseUrl('https://silo-finance.github.io/actions')).toBe(
      'https://silo-finance.github.io/actions/'
    )
    expect(normalizeSmokeBaseUrl('https://silo-finance.github.io/actions/')).toBe(
      'https://silo-finance.github.io/actions/'
    )
  })

  it('works when app is served from domain root', () => {
    expect(normalizeSmokeBaseUrl('https://example.com')).toBe('https://example.com/')
    expect(normalizeSmokeBaseUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves query and hash while normalizing path', () => {
    expect(normalizeSmokeBaseUrl('https://example.com/actions?x=1#frag')).toBe(
      'https://example.com/actions/?x=1#frag'
    )
  })
})

describe('resolveSmokeTargetUrl', () => {
  it('throws when base is missing', () => {
    expect(() => resolveSmokeTargetUrl(undefined, './vault/?x=1')).toThrow(/SMOKE_BASE_URL is required/)
  })

  it('resolves ./vault path against Pages base', () => {
    expect(
      resolveSmokeTargetUrl(
        'https://silo-finance.github.io/actions',
        './vault/?chain=1&address=0xabc'
      )
    ).toBe('https://silo-finance.github.io/actions/vault/?chain=1&address=0xabc')
  })
})
