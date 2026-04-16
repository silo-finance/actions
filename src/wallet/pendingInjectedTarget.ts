import type { Eip6963ProviderDetail } from '@/wallet/eip6963Types'

let pending: Eip6963ProviderDetail | null = null

/** Set immediately before `connectAsync` on the shared `injected` connector; cleared in `finally`. */
export function setPendingInjectedTarget(detail: Eip6963ProviderDetail | null): void {
  pending = detail
}

/** Used by wagmi `injected({ target: () => ... })` at connect time. */
export function getPendingInjectedTarget(): Eip6963ProviderDetail | null {
  return pending
}
