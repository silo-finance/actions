/**
 * Safe Transaction Service on legacy hostnames does not require an API key (unlike api.safe.global/tx-service).
 * Base URL must end with `/api` — this is what @safe-global/api-kit appends `/v2/safes/...` to.
 */
const LEGACY_TX_SERVICE_BASE_BY_CHAIN_ID: Record<number, string> = {
  1: 'https://safe-transaction-mainnet.safe.global/api',
  10: 'https://safe-transaction-optimism.safe.global/api',
  50: 'https://safe-transaction-xdc.safe.global/api',
  56: 'https://safe-transaction-bsc.safe.global/api',
  146: 'https://safe-transaction-sonic.safe.global/api',
  196: 'https://safe-transaction-xlayer.safe.global/api',
  42161: 'https://safe-transaction-arbitrum.safe.global/api',
  43114: 'https://safe-transaction-avalanche.safe.global/api',
}

export function getLegacySafeTransactionServiceBaseUrl(chainId: number): string | null {
  return LEGACY_TX_SERVICE_BASE_BY_CHAIN_ID[chainId] ?? null
}
