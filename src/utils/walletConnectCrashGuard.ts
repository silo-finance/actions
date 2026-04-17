import { extractErrorMessage } from '@/utils/rpcErrors'

/**
 * `@walletconnect/ethereum-provider` 2.23.x has a fire-and-forget bug in its
 * `session_event: chainChanged` handler:
 *
 *   setChainId(caipChainId) -> switchEthereumChain(chainId) -> this.request({ method:
 *     'wallet_switchEthereumChain', ... })
 *
 * `switchEthereumChain` does NOT await or `.catch()` the request. When the peer wallet (typically
 * Safe{Wallet} mobile) emits `chainChanged` for a chain that was not in the session's `rpcMap`
 * (e.g. Safe switched to a chain we never advertised in `optionalChains`), the nested
 * `UniversalProvider.request` hits `undefined.request(...)` inside its per-chain dispatch table
 * and throws `TypeError: Cannot read properties of undefined (reading 'request')`. The unhandled
 * rejection bubbles up to `window.onunhandledrejection` and the Next.js dev overlay shows it as a
 * loud runtime error even though the session is otherwise healthy.
 *
 * We cannot patch the library inline, so we install a narrow `unhandledrejection` filter that
 * matches exactly this signature (TypeError, message mentions `.request`, stack contains
 * `switchEthereumChain` / `setChainId` / `onSessionEventRequest`) and swallows it with a warning.
 * Everything else propagates normally.
 *
 * Idempotent: safe across React StrictMode double-invokes and Fast Refresh.
 */
const INSTALL_FLAG = '__siloWcCrashGuardInstalled'

export function installWalletConnectCrashGuard(): () => void {
  if (typeof window === 'undefined') return () => {}
  const w = window as unknown as Record<string, unknown>
  if (w[INSTALL_FLAG]) return () => {}
  w[INSTALL_FLAG] = true

  const handler = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    if (!(reason instanceof TypeError)) return
    const msg = extractErrorMessage(reason).toLowerCase()
    if (!msg.includes("reading 'request'") && !msg.includes('reading "request"')) return
    const stack = typeof reason.stack === 'string' ? reason.stack : ''
    if (!/switchEthereumChain|setChainId|onSessionEventRequest/.test(stack)) return

    console.warn(
      '[Silo Actions] Suppressed WalletConnect EthereumProvider crash: session_event chainChanged with no RPC mapping for the target chain. Library bug in @walletconnect/ethereum-provider 2.23.x.'
    )
    event.preventDefault()
  }

  window.addEventListener('unhandledrejection', handler)
  return () => {
    window.removeEventListener('unhandledrejection', handler)
    delete w[INSTALL_FLAG]
  }
}
