import { formatUnits } from 'ethers'

export type SiloMarketRole = 'collateral' | 'debt' | 'two-way'

/** Parse a WAD (1e18) LT string the same way Positions markets do. */
function parseLtRatio(raw: string | null): number | null {
  if (!raw) return null
  const parsed = /^-?\d+$/.test(raw) ? Number(formatUnits(BigInt(raw), 18)) : Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Classify a silo market side from its LT vs the sibling silo LT.
 * LT = 0 means this side cannot serve as collateral (one-way debt silo).
 * Both sides LT > 0 means two-way. Missing / unparseable / both-zero → null.
 */
export function resolveSiloMarketRole(
  ltRaw: string | null,
  otherLtRaw: string | null
): SiloMarketRole | null {
  const thisLt = parseLtRatio(ltRaw)
  const otherLt = parseLtRatio(otherLtRaw)
  if (thisLt == null || otherLt == null) return null

  const thisZero = thisLt === 0
  const otherZero = otherLt === 0
  if (!thisZero && !otherZero) return 'two-way'
  if (!thisZero && otherZero) return 'collateral'
  if (thisZero && !otherZero) return 'debt'
  return null
}
