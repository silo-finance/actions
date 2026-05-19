/** Unique position id: chain + silo (market) + borrower address. */
export function extractBorrowerAddress(raw: string): string | null {
  const trimmed = raw.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase()
  const suffix = /(0x[0-9a-fA-F]{40})$/.exec(trimmed)
  return suffix ? suffix[1].toLowerCase() : null
}

export function buildLiquidationPositionKey(
  chainId: number,
  marketId: string,
  accountId: string
): string | null {
  const borrower = extractBorrowerAddress(accountId)
  const normalizedMarketId = marketId.trim().toLowerCase()
  if (!borrower || !/^0x[0-9a-f]{40}$/.test(normalizedMarketId)) return null
  return `${chainId}:${normalizedMarketId}:${borrower}`
}
