/**
 * Single source of truth for Silo market-side role from static LT pair.
 * Dependency-free so Node consumers can import the same helpers.
 */

/**
 * @param {string | null | undefined} raw
 * @returns {boolean | null} true if LT is zero, false if non-zero, null if missing/unparseable
 */
function isZeroLt(raw) {
  if (raw == null || raw === '') return null
  const value = String(raw)
  if (!/^-?\d+$/.test(value)) return null
  try {
    return BigInt(value) === 0n
  } catch {
    return null
  }
}

/**
 * Classify a silo market side from its LT vs the sibling silo LT.
 * LT = 0 means this side cannot serve as collateral (one-way debt silo).
 * Both sides LT > 0 means two-way. Missing / unparseable / both-zero → null.
 *
 * @param {string | null | undefined} ltRaw
 * @param {string | null | undefined} otherLtRaw
 * @returns {'collateral' | 'debt' | 'two-way' | null}
 */
export function resolveSiloMarketRole(ltRaw, otherLtRaw) {
  const thisZero = isZeroLt(ltRaw)
  const otherZero = isZeroLt(otherLtRaw)
  if (thisZero == null || otherZero == null) return null

  if (!thisZero && !otherZero) return 'two-way'
  if (!thisZero && otherZero) return 'collateral'
  if (thisZero && !otherZero) return 'debt'
  return null
}

/**
 * One-way collateral-only market (this LT > 0, sibling LT = 0).
 * Tracking consumers should skip these — they have no debt/liquidations.
 *
 * @param {string | null | undefined} ltRaw
 * @param {string | null | undefined} otherLtRaw
 */
export function isCollateralOnlySilo(ltRaw, otherLtRaw) {
  return resolveSiloMarketRole(ltRaw, otherLtRaw) === 'collateral'
}
