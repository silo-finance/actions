/**
 * Heuristics for JSON-RPC / wallet transport failures (rate limits, public RPC throttling, etc.).
 * Wallets often surface HTTP 429 only in the error message string, not as a structured code.
 */
export function isLikelyRpcOrNetworkFailure(err: unknown): boolean {
  if (err == null) return false
  const e = err as {
    code?: string | number
    shortMessage?: string
    message?: string
    reason?: string
    status?: number
    body?: string
  }
  const parts = [e.shortMessage, e.message, e.reason, e.body, typeof e.code === 'string' ? e.code : '']
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
  const blob = parts.join(' ')

  if (e.status === 429) return true
  if (typeof e.code === 'number' && (e.code === 429 || e.code === -32005 || e.code === -32624)) return true

  return (
    blob.includes('429') ||
    blob.includes('too many requests') ||
    blob.includes('rate limit') ||
    blob.includes('exceeded') ||
    blob.includes('net::err_failed') ||
    blob.includes('failed to fetch') ||
    blob.includes('networkerror') ||
    blob.includes('network request failed') ||
    blob.includes('load failed') ||
    blob.includes('could not coalesce error') ||
    blob.includes('server error') ||
    blob.includes('internal json-rpc error')
  )
}

/** User-facing copy when we could not finish on-chain reads via the wallet RPC. */
export function formatWalletRpcFailureMessage(err: unknown): string {
  if (isLikelyRpcOrNetworkFailure(err)) {
    return (
      'Could not verify your vault permissions: the network RPC returned an error (often HTTP 429 rate limiting on the public endpoint your wallet uses, for example Arbitrum in MetaMask). ' +
      'Try again in a moment, switch the network’s RPC URL in your wallet settings to another provider, or retry below.'
    )
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err != null && 'message' in err
        ? String((err as { message: unknown }).message)
        : ''
  const tail = msg.trim() ? ` Details: ${msg.trim()}` : ''
  return `Could not verify your vault permissions because a chain read failed.${tail}`
}
