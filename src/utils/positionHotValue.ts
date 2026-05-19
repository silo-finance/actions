export const HOT_VALUE_TOP_FRACTION = 0.01
export const HOT_VALUE_MIN_RATIO = 10

export type HotValueEntry = {
  id: string
  value: number | null
}

/**
 * Top 1% of positions by value (including ties at the cutoff). Shows flame only when
 * the lowest value in that group is at least 10× the highest value among the rest.
 */
export function resolveHotValuePositionIds(entries: HotValueEntry[]): Set<string> {
  const withValue = entries.flatMap((entry) =>
    entry.value != null && Number.isFinite(entry.value) && entry.value > 0
      ? [{ id: entry.id, value: entry.value }]
      : []
  )
  if (withValue.length < 2) return new Set()

  const sorted = [...withValue].sort((a, b) => b.value - a.value)
  const topCount = Math.max(1, Math.ceil(sorted.length * HOT_VALUE_TOP_FRACTION))
  const cutoffValue = sorted[topCount - 1]!.value
  const topGroup = sorted.filter((entry) => entry.value >= cutoffValue)
  const rest = sorted.filter((entry) => entry.value < cutoffValue)
  if (rest.length === 0) return new Set()

  const minTop = Math.min(...topGroup.map((entry) => entry.value))
  const maxRemaining = Math.max(...rest.map((entry) => entry.value))
  if (minTop < HOT_VALUE_MIN_RATIO * maxRemaining) return new Set()

  return new Set(topGroup.map((entry) => entry.id))
}
