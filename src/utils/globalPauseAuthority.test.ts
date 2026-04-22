import { describe, expect, it } from 'vitest'
import { deriveTargetAuthorityStatus } from '@/utils/globalPauseAuthority'

const GLOBAL_PAUSE = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

describe('deriveTargetAuthorityStatus', () => {
  it('returns authorized when hasRole is true even if ownership mismatches', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: true, owner: OTHER, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'authorized' })
  })

  it('returns authorized when Global Pause is the owner (ownership-based contract)', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: null, owner: GLOBAL_PAUSE, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'authorized' })
  })

  it('returns pending-ownership when Global Pause is the pending owner', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: null, owner: OTHER, pendingOwner: GLOBAL_PAUSE },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'pending-ownership' })
  })

  it('prefers authorized over pending-ownership when both match', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: true, owner: OTHER, pendingOwner: GLOBAL_PAUSE },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'authorized' })
  })

  it('returns not-owner for ownership-based contract where Global Pause is neither owner nor pending', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: null, owner: OTHER, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'not-owner' })
  })

  it('returns not-owner when owner probe succeeds and pendingOwner probe reverted', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: false, owner: OTHER, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'not-owner' })
  })

  it('returns no-role when hasRole probe succeeded with false and ownership probes reverted', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: false, owner: null, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'no-role' })
  })

  it('returns unknown when every probe reverted', () => {
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: null, owner: null, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'unknown' })
  })

  it('treats different letter-case addresses as equal (checksum-aware)', () => {
    const mixedCase = GLOBAL_PAUSE.replace('0x', '0X')
    expect(
      deriveTargetAuthorityStatus(
        { hasRole: null, owner: mixedCase, pendingOwner: null },
        GLOBAL_PAUSE
      )
    ).toEqual({ kind: 'authorized' })
  })
})
