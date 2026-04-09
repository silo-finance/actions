import { getAddress } from 'ethers'

/** Address array for `setSupplyQueue` — paste into multisig / contract UI. */
export function formatSetSupplyQueueArgsCopy(addresses: string[]): string {
  const parts = addresses.map((raw) => {
    try {
      return getAddress(raw)
    } catch {
      return raw
    }
  })
  return `[${parts.join(', ')}]`
}

/** Single market address for `acceptCap(_market)`. */
export function formatAcceptCapArgsCopy(market: string): string {
  try {
    return getAddress(market)
  } catch {
    return market
  }
}
