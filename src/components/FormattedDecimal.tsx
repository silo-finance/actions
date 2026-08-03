import { applyFractionPadding, splitFormattedDecimal } from '@/utils/format/decimalDisplay'

type FormattedDecimalProps = {
  value: string
  className?: string
  /** When set, pad the fractional part to this many digits (e.g. 2 → `.00`, `.20`). */
  fractionDigits?: number
}

/** Renders a pre-formatted number with a smaller fractional part when present. */
export default function FormattedDecimal({ value, className, fractionDigits }: FormattedDecimalProps) {
  const parts = applyFractionPadding(splitFormattedDecimal(value), fractionDigits)

  if (parts.fraction == null) {
    return <span className={className}>{value}</span>
  }

  return (
    <span className={`inline-flex items-baseline tabular-nums${className ? ` ${className}` : ''}`}>
      <span>{parts.integer}</span>
      <span className="text-[0.82em]">{parts.fraction}</span>
      {parts.suffix ? <span className="text-[0.82em]">{parts.suffix}</span> : null}
    </span>
  )
}
