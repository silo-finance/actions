import {
  POSITION_PRIORITY_TICK_COUNT,
  priorityFilledTickCount,
} from '@/utils/healthFactor'

type PositionPriorityTicksProps = {
  priority: number | null
  minPriority: number
  maxPriority: number
  isInsolvent: boolean
  isWarning: boolean
  /** Temporary: show exact priority under the bar for calibration. */
  showDebugValue?: boolean
}

const EMPTY_TICK_CLASS = 'bg-[color-mix(in_srgb,var(--silo-text)_20%,transparent)]'

function formatPriorityInteger(priority: number): string {
  return String(Math.trunc(priority))
}

function formatPriorityTooltip(priority: number, filled: number): string {
  return `Priority: ${formatPriorityInteger(priority)} (${filled}/${POSITION_PRIORITY_TICK_COUNT})`
}

export default function PositionPriorityTicks({
  priority,
  minPriority,
  maxPriority,
  isInsolvent,
  isWarning,
  showDebugValue = true,
}: PositionPriorityTicksProps) {
  if (priority == null || !Number.isFinite(priority)) {
    return <span className="silo-text-soft text-xs">—</span>
  }

  const filled = priorityFilledTickCount(priority, minPriority, maxPriority)
  const filledClass = isInsolvent
    ? 'bg-[color-mix(in_srgb,var(--silo-danger)_82%,#4f0f1c)]'
    : isWarning
      ? 'bg-[color-mix(in_srgb,var(--silo-warning)_78%,#5a3b12)]'
      : 'bg-[color-mix(in_srgb,var(--silo-text)_88%,#1f2430)]'
  const label = formatPriorityTooltip(priority, filled)

  return (
    <div className="inline-flex flex-col items-end gap-0.5" title={label} aria-label={label}>
      <div className="inline-flex items-end justify-end gap-px h-4" role="img">
        {Array.from({ length: POSITION_PRIORITY_TICK_COUNT }, (_, index) => (
          <span
            key={index}
            className={`w-[3px] h-3.5 rounded-[1px] ${index < filled ? filledClass : EMPTY_TICK_CLASS}`}
          />
        ))}
      </div>
      {showDebugValue ? (
        <span className="text-[10px] leading-none silo-text-faint tabular-nums">
          {formatPriorityInteger(priority)}
        </span>
      ) : null}
    </div>
  )
}
