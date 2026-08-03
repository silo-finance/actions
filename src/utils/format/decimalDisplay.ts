export type SplitFormattedDecimal = {
  integer: string
  fraction: string | null
  suffix: string
}

const PASSTHROUGH_VALUES = new Set(['—', 'N/A', ''])

function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value)
}

export function getDecimalSeparator(locale?: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
  )
}

/**
 * Split an already-formatted number string into integer and fractional display parts.
 * Uses the runtime locale decimal separator so grouping (e.g. `1,234`) is never
 * mistaken for a fraction, and values like `0.001` / `1.234` still split correctly.
 */
export function splitFormattedDecimal(formatted: string, locale?: string): SplitFormattedDecimal {
  const trimmed = formatted.trim()
  if (PASSTHROUGH_VALUES.has(trimmed)) {
    return { integer: trimmed, fraction: null, suffix: '' }
  }

  let suffix = ''
  let body = trimmed
  if (body.endsWith('%')) {
    suffix = '%'
    body = body.slice(0, -1)
  }

  const decimalSep = getDecimalSeparator(locale)
  const splitIndex = body.lastIndexOf(decimalSep)
  if (splitIndex === -1) {
    return { integer: trimmed, fraction: null, suffix }
  }

  const afterSep = body.slice(splitIndex + 1)
  // Fraction must be digits only; grouping separators never appear after the decimal.
  if (!isDigitsOnly(afterSep) || afterSep.length === 0) {
    return { integer: trimmed, fraction: null, suffix }
  }

  return {
    integer: body.slice(0, splitIndex),
    fraction: body.slice(splitIndex),
    suffix,
  }
}

/** Pad fractional digits when a fixed display width is configured (does not truncate longer fractions). */
export function applyFractionPadding(
  parts: SplitFormattedDecimal,
  fractionDigits?: number,
  locale?: string
): SplitFormattedDecimal {
  if (fractionDigits == null || fractionDigits <= 0) return parts
  if (PASSTHROUGH_VALUES.has(parts.integer.trim())) return parts

  const existingDigits = parts.fraction ? parts.fraction.slice(1) : ''
  if (existingDigits.length > fractionDigits) return parts

  const separator = parts.fraction?.[0] ?? getDecimalSeparator(locale)
  const paddedDigits = existingDigits.padEnd(fractionDigits, '0')
  return {
    integer: parts.integer,
    fraction: separator + paddedDigits,
    suffix: parts.suffix,
  }
}
