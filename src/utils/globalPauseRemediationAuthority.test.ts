import { describe, expect, it } from 'vitest'
import type { TargetAuthorityStatus } from '@/utils/globalPauseAuthority'
import {
  classifyRemediationForTarget,
  groupRemediationForBulk,
  pickRemediationMode,
  preferRoleThenOwnership,
  type CandidateStatus,
  type RemediationMap,
  type RemediationPlan,
} from '@/utils/globalPauseRemediationAuthority'

const ME = '0x1111111111111111111111111111111111111111'
const SAFE_A = '0x2222222222222222222222222222222222222222'
const SAFE_B = '0x3333333333333333333333333333333333333333'
const OTHER = '0x4444444444444444444444444444444444444444'
const TARGET_X = '0x9999999999999999999999999999999999999999'
const TARGET_Y = '0x8888888888888888888888888888888888888888'

const NOT_OWNER_STATUS: TargetAuthorityStatus = { kind: 'not-owner' }
const NO_ROLE_STATUS: TargetAuthorityStatus = { kind: 'no-role' }

function eoa(address: string): CandidateStatus {
  return { address, isSafe: false, isSafeOwner: false }
}

function safeWithMe(address: string): CandidateStatus {
  return { address, isSafe: true, isSafeOwner: true }
}

function safeWithoutMe(address: string): CandidateStatus {
  return { address, isSafe: true, isSafeOwner: false }
}

describe('pickRemediationMode', () => {
  it('returns direct when the first candidate equals the connected EOA', () => {
    expect(pickRemediationMode([eoa(ME)], ME)).toEqual({ kind: 'direct' })
  })

  it('returns safe_as_wallet when connected account equals a Safe candidate', () => {
    expect(pickRemediationMode([safeWithMe(ME)], ME)).toEqual({
      kind: 'safe_as_wallet',
      safeAddress: ME,
    })
  })

  it('returns safe_propose for a Safe where the connected EOA is an owner', () => {
    expect(pickRemediationMode([safeWithMe(SAFE_A)], ME)).toEqual({
      kind: 'safe_propose',
      safeAddress: SAFE_A,
    })
  })

  it('returns denied when no candidate matches', () => {
    expect(pickRemediationMode([eoa(OTHER), safeWithoutMe(SAFE_A)], ME)).toEqual({ kind: 'denied' })
  })

  it('honors order: earlier candidate wins over later match', () => {
    expect(pickRemediationMode([eoa(OTHER), safeWithMe(SAFE_A), eoa(ME)], ME)).toEqual({
      kind: 'safe_propose',
      safeAddress: SAFE_A,
    })
  })

  it('falls through earlier non-matching candidates to a later safe_propose', () => {
    expect(pickRemediationMode([eoa(OTHER), safeWithoutMe(SAFE_B), safeWithMe(SAFE_A)], ME)).toEqual({
      kind: 'safe_propose',
      safeAddress: SAFE_A,
    })
  })

  it('treats empty candidate list as denied', () => {
    expect(pickRemediationMode([], ME)).toEqual({ kind: 'denied' })
  })

  it('handles mixed-case connected account via checksum comparison', () => {
    const mixedCase = ME.toUpperCase().replace('0X', '0x')
    expect(pickRemediationMode([eoa(ME)], mixedCase)).toEqual({ kind: 'direct' })
  })
})

describe('classifyRemediationForTarget', () => {
  it('builds a transferOwnership plan for not-owner status', () => {
    const plan = classifyRemediationForTarget({
      target: TARGET_X,
      status: NOT_OWNER_STATUS,
      candidates: [eoa(ME)],
      connectedAccount: ME,
    })
    expect(plan).toEqual({
      target: TARGET_X,
      action: { kind: 'transferOwnership' },
      mode: { kind: 'direct' },
    })
  })

  it('builds a grantRole plan for no-role status with PAUSER_ROLE', () => {
    const plan = classifyRemediationForTarget({
      target: TARGET_X,
      status: NO_ROLE_STATUS,
      candidates: [safeWithMe(SAFE_A)],
      connectedAccount: ME,
    })
    expect(plan?.action.kind).toBe('grantRole')
    if (plan?.action.kind === 'grantRole') {
      expect(plan.action.role).toBe(
        '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a'
      )
    }
    expect(plan?.mode).toEqual({ kind: 'safe_propose', safeAddress: SAFE_A })
  })

  it('returns null for statuses outside not-owner / no-role', () => {
    expect(
      classifyRemediationForTarget({
        target: TARGET_X,
        status: { kind: 'authorized' },
        candidates: [eoa(ME)],
        connectedAccount: ME,
      })
    ).toBeNull()
    expect(
      classifyRemediationForTarget({
        target: TARGET_X,
        status: { kind: 'pending-ownership' },
        candidates: [eoa(ME)],
        connectedAccount: ME,
      })
    ).toBeNull()
    expect(
      classifyRemediationForTarget({
        target: TARGET_X,
        status: { kind: 'unknown' },
        candidates: [eoa(ME)],
        connectedAccount: ME,
      })
    ).toBeNull()
  })

  it('falls back to denied when candidates are empty (role enumeration returned nothing)', () => {
    const plan = classifyRemediationForTarget({
      target: TARGET_X,
      status: NO_ROLE_STATUS,
      candidates: [],
      connectedAccount: ME,
    })
    expect(plan?.mode).toEqual({ kind: 'denied' })
  })

  it('grant-role fallback: PAUSER_ROLE_ADMIN holders exhausted, DEFAULT_ADMIN_ROLE holder matches', () => {
    /** Candidates arrive in priority order: PAUSER_ROLE_ADMIN first, DEFAULT_ADMIN_ROLE second. */
    const plan = classifyRemediationForTarget({
      target: TARGET_X,
      status: NO_ROLE_STATUS,
      candidates: [eoa(OTHER), safeWithoutMe(SAFE_B), safeWithMe(SAFE_A)],
      connectedAccount: ME,
    })
    expect(plan?.mode).toEqual({ kind: 'safe_propose', safeAddress: SAFE_A })
  })
})

function makePlan(target: string, mode: RemediationPlan['mode']): RemediationPlan {
  return {
    target,
    action: { kind: 'transferOwnership' },
    mode,
  }
}

function makeRolePlan(target: string, mode: RemediationPlan['mode']): RemediationPlan {
  return {
    target,
    action: {
      kind: 'grantRole',
      role: '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a',
    },
    mode,
  }
}

describe('preferRoleThenOwnership', () => {
  it('returns null when both inputs are null', () => {
    expect(preferRoleThenOwnership(null, null)).toBeNull()
  })

  it('returns the role plan when it is actionable, even if ownership is also actionable', () => {
    const role = makeRolePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A })
    const ownership = makePlan(TARGET_X, { kind: 'direct' })
    expect(preferRoleThenOwnership(role, ownership)).toBe(role)
  })

  it('falls back to ownership plan when role plan is denied', () => {
    const role = makeRolePlan(TARGET_X, { kind: 'denied' })
    const ownership = makePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A })
    expect(preferRoleThenOwnership(role, ownership)).toBe(ownership)
  })

  it('falls back to ownership plan when role plan is missing', () => {
    const ownership = makePlan(TARGET_X, { kind: 'direct' })
    expect(preferRoleThenOwnership(null, ownership)).toBe(ownership)
  })

  it('returns role plan (denied) when both are denied and role is present', () => {
    const role = makeRolePlan(TARGET_X, { kind: 'denied' })
    const ownership = makePlan(TARGET_X, { kind: 'denied' })
    expect(preferRoleThenOwnership(role, ownership)).toBe(role)
  })

  it('covers the hybrid-contract case: status "not-owner" where owner is a Safe the user does not sign, but PAUSER_ROLE_ADMIN holder is a Safe the user co-signs', () => {
    const role = makeRolePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A })
    const ownership = makePlan(TARGET_X, { kind: 'denied' })
    expect(preferRoleThenOwnership(role, ownership)).toBe(role)
  })
})

function makeMap(plans: RemediationPlan[]): RemediationMap {
  const m = new Map<string, RemediationPlan>()
  for (const p of plans) m.set(p.target.toLowerCase(), p)
  return m
}

describe('groupRemediationForBulk', () => {
  it('returns none when the map has no actionable plans', () => {
    expect(groupRemediationForBulk(new Map())).toEqual({ kind: 'none' })
    expect(
      groupRemediationForBulk(makeMap([makePlan(TARGET_X, { kind: 'denied' })]))
    ).toEqual({ kind: 'none' })
  })

  it('returns single_safe_batch when every plan is safe_propose for the same Safe', () => {
    const result = groupRemediationForBulk(
      makeMap([
        makePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A }),
        makePlan(TARGET_Y, { kind: 'safe_propose', safeAddress: SAFE_A }),
      ])
    )
    expect(result.kind).toBe('single_safe_batch')
    if (result.kind === 'single_safe_batch') {
      expect(result.safeAddress).toBe(SAFE_A)
      expect(result.items).toHaveLength(2)
    }
  })

  it('falls back to per_row when safe_propose Safes differ between plans', () => {
    const result = groupRemediationForBulk(
      makeMap([
        makePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A }),
        makePlan(TARGET_Y, { kind: 'safe_propose', safeAddress: SAFE_B }),
      ])
    )
    expect(result).toEqual({ kind: 'per_row' })
  })

  it('falls back to per_row when one plan is direct and another is safe_propose', () => {
    const result = groupRemediationForBulk(
      makeMap([
        makePlan(TARGET_X, { kind: 'direct' }),
        makePlan(TARGET_Y, { kind: 'safe_propose', safeAddress: SAFE_A }),
      ])
    )
    expect(result).toEqual({ kind: 'per_row' })
  })

  it('ignores denied plans when deciding bulk eligibility', () => {
    const result = groupRemediationForBulk(
      makeMap([
        makePlan(TARGET_X, { kind: 'safe_propose', safeAddress: SAFE_A }),
        makePlan(TARGET_Y, { kind: 'denied' }),
      ])
    )
    expect(result.kind).toBe('single_safe_batch')
    if (result.kind === 'single_safe_batch') {
      expect(result.items).toHaveLength(1)
    }
  })

  it('per_row when safe_as_wallet is involved (cannot be bundled into a Safe propose batch)', () => {
    const result = groupRemediationForBulk(
      makeMap([
        makePlan(TARGET_X, { kind: 'safe_as_wallet', safeAddress: SAFE_A }),
        makePlan(TARGET_Y, { kind: 'safe_propose', safeAddress: SAFE_A }),
      ])
    )
    expect(result).toEqual({ kind: 'per_row' })
  })
})
