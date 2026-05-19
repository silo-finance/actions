/** Display/calculation cap: 2.00 means user LTV has reached 100%. */
export const MAX_HEALTH_FACTOR = 2

/**
 * Health factor vs liquidation threshold (LT), both as ratios in [0, 1] scale (e.g. 0.8 = 80%).
 * Below/at LT: HF = userLtv / lt (unchanged; 1.00 at LT).
 * Above LT: HF = 1 + (userLtv - lt) / (1 - lt), capped at {@link MAX_HEALTH_FACTOR}.
 */
export function computeHealthFactor(
  userLtvRatio: number | null | undefined,
  liquidationThresholdRatio: number | null | undefined
): number | null {
  if (
    userLtvRatio == null ||
    liquidationThresholdRatio == null ||
    !Number.isFinite(userLtvRatio) ||
    !Number.isFinite(liquidationThresholdRatio) ||
    liquidationThresholdRatio <= 0
  ) {
    return null
  }

  if (userLtvRatio <= liquidationThresholdRatio) {
    return userLtvRatio / liquidationThresholdRatio
  }

  const roomToFullLtv = 1 - liquidationThresholdRatio
  if (roomToFullLtv <= 0) return MAX_HEALTH_FACTOR

  const healthFactor = 1 + (userLtvRatio - liquidationThresholdRatio) / roomToFullLtv
  return Math.min(healthFactor, MAX_HEALTH_FACTOR)
}

export function capDisplayHealthFactor(value: number): number {
  if (!Number.isFinite(value)) return value
  return Math.min(value, MAX_HEALTH_FACTOR)
}
