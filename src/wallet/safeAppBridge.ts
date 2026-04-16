import SafeAppsSDK from '@safe-global/safe-apps-sdk'

export type SafeAppInfo = {
  safeAddress: string
  chainId: number
}

/**
 * Returns Safe host context when the app runs inside Safe{Wallet} (iframe). Uses a short timeout
 * so non-Safe iframes do not hang. Prefer wagmi `safe()` connector for actual connection; this is
 * for optional UI (e.g. confirming context) or tooling outside React.
 */
export async function initSafeAppBridge(timeoutMs = 80): Promise<SafeAppInfo | null> {
  if (typeof window === 'undefined' || window.parent === window) return null
  try {
    const sdk = new SafeAppsSDK()
    const info = await Promise.race([
      sdk.safe.getInfo(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('safe_info_timeout')), timeoutMs)
      }),
    ])
    const cid = info.chainId
    return {
      safeAddress: info.safeAddress,
      chainId: typeof cid === 'number' ? cid : Number(cid),
    }
  } catch {
    return null
  }
}
