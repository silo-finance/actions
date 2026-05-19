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

/** Liquidation priority proxy: larger debt × higher health factor ranks higher. */
export function computePositionPriority(
  debtValue: number | null | undefined,
  healthFactor: number | null | undefined
): number | null {
  if (
    debtValue == null ||
    healthFactor == null ||
    !Number.isFinite(debtValue) ||
    !Number.isFinite(healthFactor)
  ) {
    return null
  }
  return debtValue * healthFactor
}

/** Sort tier: insolvent (0), warning (1), normal (2). */
export function positionRiskSortTier(isInsolvent: boolean, isWarning: boolean): number {
  if (isInsolvent) return 0
  if (isWarning) return 1
  return 2
}

export const POSITION_PRIORITY_TICK_COUNT = 10

/** Trim 1st/99th percentile bounds only when a tier has at least this many priorities. */
export const PRIORITY_SCALE_TRIM_MIN_SAMPLE_SIZE = 4

export const PRIORITY_SCALE_TRIM_FRACTION = 0.01

export type PositionPriorityScale = { min: number; max: number }

export type PositionPriorityScaleByTier = {
  insolvent: PositionPriorityScale
  warning: PositionPriorityScale
  normal: PositionPriorityScale
}

/**
 * Scale bounds for a tier. With 4+ samples, drops bottom/top 1% by count
 * (rounded up), so outliers do not influence the bar scale. With 3 or fewer,
 * uses raw min/max so tiny tiers are not over-trimmed.
 */
export function resolveTrimmedPriorityScale(values: readonly number[]): PositionPriorityScale {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return { min: 0, max: 0 }
  const sorted = [...finite].sort((a, b) => a - b)
  if (sorted.length < PRIORITY_SCALE_TRIM_MIN_SAMPLE_SIZE) {
    return { min: sorted[0]!, max: sorted[sorted.length - 1]! }
  }
  const trimCount = Math.ceil(sorted.length * PRIORITY_SCALE_TRIM_FRACTION)
  const lowerIndex = Math.min(trimCount, sorted.length - 1)
  const upperIndex = Math.max(lowerIndex, sorted.length - 1 - trimCount)
  return { min: sorted[lowerIndex]!, max: sorted[upperIndex]! }
}

export function resolvePositionPriorityScale(
  priorities: Array<number | null | undefined>
): PositionPriorityScale {
  const finite = priorities.filter((priority): priority is number => priority != null && Number.isFinite(priority))
  return resolveTrimmedPriorityScale(finite)
}

/**
 * Maps priority to filled ticks: scale min → 0, scale max → all ticks,
 * strictly above min → at least 1 tick, linear in between.
 */
export function priorityFilledTickCount(
  priority: number | null | undefined,
  minPriority: number,
  maxPriority: number,
  tickCount: number = POSITION_PRIORITY_TICK_COUNT
): number {
  if (priority == null || !Number.isFinite(priority) || tickCount <= 0) return 0
  if (priority <= minPriority) return 0
  if (priority >= maxPriority) return tickCount
  if (maxPriority <= minPriority) return 1

  const ratio = (priority - minPriority) / (maxPriority - minPriority)
  const linear = Math.round(ratio * tickCount)
  return Math.max(1, Math.min(tickCount - 1, linear))
}

export function resolvePositionPriorityScaleByTier(
  rows: Array<{
    priority: number | null
    isInsolvent: boolean
    isWarning: boolean
  }>
): PositionPriorityScaleByTier {
  const insolvent: number[] = []
  const warning: number[] = []
  const normal: number[] = []
  for (const row of rows) {
    if (row.priority == null || !Number.isFinite(row.priority)) continue
    if (row.isInsolvent) insolvent.push(row.priority)
    else if (row.isWarning) warning.push(row.priority)
    else normal.push(row.priority)
  }
  return {
    insolvent: resolvePositionPriorityScale(insolvent),
    warning: resolvePositionPriorityScale(warning),
    normal: resolvePositionPriorityScale(normal),
  }
}

export function priorityScaleForRiskTier(
  scales: PositionPriorityScaleByTier,
  isInsolvent: boolean,
  isWarning: boolean
): PositionPriorityScale {
  if (isInsolvent) return scales.insolvent
  if (isWarning) return scales.warning
  return scales.normal
}
