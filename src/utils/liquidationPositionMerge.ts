import type { OpenMarketPosition } from '@/utils/liquidationGraph'
import type { ExternalPositionRecord, ExternalPositionsData } from '@/utils/liquidationExternalPositions'
import { buildLiquidationPositionKey, extractBorrowerAddress } from '@/utils/liquidationPositionIdentity'

export function toOpenMarketPositionFromExternal(row: ExternalPositionRecord): OpenMarketPosition {
  const borrower = extractBorrowerAddress(row.accountId) ?? row.accountId
  return {
    id: `${row.marketId}-${borrower}-external`,
    chainId: row.chainId,
    marketId: row.marketId,
    lastUpdatedTimestamp: row.lastUpdatedTimestamp,
    accountId: borrower,
    ltv: row.ltv,
    debtValue: row.debtValue,
    collateralValue: row.collateralValue,
    debtAssets: null,
    collateralAssets: null,
    isInBadDet: null,
  }
}

export function mergeExternalIntoGraphPosition(
  row: OpenMarketPosition,
  chainId: number,
  marketId: string,
  externalData: ExternalPositionsData | undefined
): OpenMarketPosition {
  if (!externalData) return row
  const key = buildLiquidationPositionKey(chainId, marketId, row.accountId)
  if (!key) return row
  const external = externalData.byPositionKey.get(key)
  if (!external) return row
  const borrower = extractBorrowerAddress(row.accountId) ?? row.accountId
  return {
    ...row,
    accountId: borrower,
    ltv: external.ltv ?? row.ltv,
    debtValue: external.debtValue ?? row.debtValue,
    collateralValue: external.collateralValue ?? row.collateralValue,
    lastUpdatedTimestamp: external.lastUpdatedTimestamp ?? row.lastUpdatedTimestamp,
  }
}

/** Graph + external JSON merged by borrower+silo; legacy markets use external JSON only. */
export function mergeMarketPositionItems(
  chainId: number,
  marketId: string,
  marketVersion: 'v3' | 'legacy',
  graphItems: OpenMarketPosition[],
  externalData: ExternalPositionsData | undefined
): OpenMarketPosition[] {
  const marketKey = `${chainId}:${marketId.toLowerCase()}`

  if (marketVersion === 'legacy') {
    return (externalData?.byMarketKey.get(marketKey) ?? []).map(toOpenMarketPositionFromExternal)
  }

  const byKey = new Map<string, OpenMarketPosition>()
  for (const item of graphItems) {
    const key = buildLiquidationPositionKey(chainId, marketId, item.accountId)
    if (!key) continue
    byKey.set(key, mergeExternalIntoGraphPosition(item, chainId, marketId, externalData))
  }
  return Array.from(byKey.values())
}

export function solvencyMapFromExternalMarket(
  externalData: ExternalPositionsData | undefined,
  marketKey: string
): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const item of externalData?.byMarketKey.get(marketKey) ?? []) {
    if (item.solvent == null) continue
    const borrower = extractBorrowerAddress(item.accountId)
    if (!borrower) continue
    out.set(borrower, item.solvent)
  }
  return out
}
