import { getAddress } from 'ethers'

/**
 * EIP-3770 short names as used by Safe{Wallet} in `?safe=` query params.
 * Keys align with chains where we use the legacy Transaction Service host.
 */
const SAFE_EIP3770_PREFIX: Record<number, string> = {
  1: 'eth',
  10: 'oeth',
  50: 'xdc',
  56: 'bnb',
  146: 'sonic',
  196: 'okb',
  42161: 'arb1',
  43114: 'avax',
}

const SAFE_APP_ORIGIN = 'https://app.safe.global'

function eip3770Safe(chainId: number, safeAddress: string): string | null {
  const prefix = SAFE_EIP3770_PREFIX[chainId]
  if (!prefix) return null
  return `${prefix}:${getAddress(safeAddress)}`
}

/** Safe{Wallet} transaction queue for this chain + Safe owner. */
export function getSafeWalletQueueUrl(chainId: number, safeAddress: string): string | null {
  const full = eip3770Safe(chainId, safeAddress)
  if (!full) return null
  return `${SAFE_APP_ORIGIN}/transactions/queue?safe=${encodeURIComponent(full)}`
}
