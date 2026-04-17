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

/**
 * Recursively searches a thrown value for a human-readable string. Handles:
 *   - native `Error` (`.message`)
 *   - viem-style `{ shortMessage, message }`
 *   - ethers-style `{ reason, info, error, cause }`
 *   - EIP-1193 `{ code, message, data: { code, message } }`
 *   - pino-log payloads from Safe / WalletConnect: `{ time, level, msg }`
 *   - plain strings
 * Returns an empty string when nothing useful can be extracted (so callers can supply a fallback
 * instead of showing `[object Object]`).
 */
export function extractErrorMessage(err: unknown, depth = 0): string {
  if (err == null || depth > 5) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error && typeof err.message === 'string' && err.message.trim() !== '') {
    return err.message
  }
  if (typeof err !== 'object') return String(err)

  const e = err as Record<string, unknown>

  // Pick the best direct string field; check the common keys from viem / ethers / EIP-1193 / pino.
  const keys = ['shortMessage', 'message', 'reason', 'msg', 'description', 'body']
  for (const k of keys) {
    const v = e[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }

  // Recurse into common nested-error wrappers.
  const nestedKeys = ['cause', 'error', 'info', 'data', 'originalError', 'innerError']
  for (const k of nestedKeys) {
    const nested = e[k]
    if (nested != null) {
      const inner = extractErrorMessage(nested, depth + 1)
      if (inner) return inner
    }
  }
  return ''
}

/**
 * Detects whether a thrown value represents the user rejecting the wallet prompt. Covers
 * EIP-1193 code 4001, ethers' `ACTION_REJECTED`, and phrasing variants emitted by Rabby,
 * MetaMask, Safe{Wallet}, Rainbow, etc.
 */
export function isUserRejectionError(err: unknown): boolean {
  if (err == null) return false
  const e = err as { code?: string | number; data?: { code?: string | number } }
  if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true
  if (e.data?.code === 4001 || e.data?.code === 'ACTION_REJECTED') return true
  const msg = extractErrorMessage(err).toLowerCase()
  return (
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('user disapproved') ||
    msg.includes('request rejected') ||
    msg.includes('rejected by user') ||
    msg.includes('transaction rejected') ||
    msg.includes('user cancelled') ||
    msg.includes('user canceled')
  )
}

/**
 * Turns any thrown value into a short, user-facing message. Collapses user-rejection errors into
 * a single friendly sentence and otherwise returns the best-effort extracted message (falling back
 * to `fallback` if we could not find anything readable — never `[object Object]`).
 */
export function toUserErrorMessage(err: unknown, fallback = 'Transaction failed.'): string {
  if (isUserRejectionError(err)) return 'Transaction rejected in wallet.'
  const msg = extractErrorMessage(err).trim()
  return msg || fallback
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
