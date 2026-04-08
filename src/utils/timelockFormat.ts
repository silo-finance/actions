/**
 * SiloVault.timelock() is a duration in seconds.
 * Returns display line: human days + raw seconds from chain (for parentheses).
 */
export function formatTimelockSeconds(seconds: bigint): { daysText: string; rawSeconds: string } {
  const rawSeconds = seconds.toString()
  if (seconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { daysText: '—', rawSeconds }
  }
  const n = Number(seconds)
  const days = n / 86400
  const daysText = `${days.toFixed(2)} days`
  return { daysText, rawSeconds }
}
