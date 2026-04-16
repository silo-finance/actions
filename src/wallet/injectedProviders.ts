import type { Eip6963ProviderDetail } from '@/wallet/eip6963Types'

/** Dedupe by `rdns` when present, else `uuid`. */
const byKey = new Map<string, Eip6963ProviderDetail>()

function upsert(detail: Eip6963ProviderDetail): void {
  const key = detail.info.rdns || detail.info.uuid
  byKey.set(key, detail)
}

export function getInjectedProvidersSnapshot(): Eip6963ProviderDetail[] {
  return Array.from(byKey.values())
}

/**
 * Subscribe to EIP-6963 announcements. Dispatches `eip6963:requestProvider` once so wallets that
 * are already injected respond.
 */
export function subscribeInjectedAnnounce(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const onAnnounce = (event: Event) => {
    const e = event as CustomEvent<Eip6963ProviderDetail>
    upsert(e.detail)
    onStoreChange()
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  window.dispatchEvent(new CustomEvent('eip6963:requestProvider'))
  return () => window.removeEventListener('eip6963:announceProvider', onAnnounce)
}
