/**
 * Single env for the shared data branch root (legacy-positions).
 * Example: https://raw.githubusercontent.com/silo-finance/actions/refs/heads/legacy-positions
 */
export function getLiquidationDataBranchBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_LIQ_SILOS_BASE_URL ?? '').trim().replace(/\/$/, '')
}

export function resolveSiloSnapshotUrl(chainKey: string): string {
  const base = getLiquidationDataBranchBaseUrl()
  if (!base) {
    throw new Error(
      `Missing NEXT_PUBLIC_LIQ_SILOS_BASE_URL (data branch root) for silo snapshot ${chainKey}.`
    )
  }
  return `${base}/src/data/silos/${chainKey}.json`
}

export function resolveLegacyPositionsUrl(chainKey: string): string | null {
  const base = getLiquidationDataBranchBaseUrl()
  if (!base) return null
  return `${base}/scripts/pull_borrowers/${chainKey}_positions.json`
}
