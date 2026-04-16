'use client'

import { useSyncExternalStore } from 'react'
import type { ConnectMethod } from '@/contexts/Web3Context'
import { getInjectedProvidersSnapshot, subscribeInjectedAnnounce } from '@/wallet/injectedProviders'

type Props = {
  onPick: (method: ConnectMethod) => void
  connectInjectedByRdns: (rdnsOrUuid: string) => Promise<void>
  /** Muted helper line uses header tokens in bar, theme tokens in modal */
  mutedClassName?: string
}

export default function ConnectWalletPanelContent({
  onPick,
  connectInjectedByRdns,
  mutedClassName = 'text-xs font-medium silo-text-soft',
}: Props) {
  const announced = useSyncExternalStore(
    subscribeInjectedAnnounce,
    getInjectedProvidersSnapshot,
    () => []
  )

  return (
    <>
      <p className="wallet-connect-label">Connect with</p>
      <p className={`px-2 -mt-0.5 pb-1 leading-snug ${mutedClassName}`}>
        Browser extension or WalletConnect. Pick a listed wallet (EIP-6963) or use the default extension
        button.
      </p>
      {announced.length > 0 ? (
        <>
          <p className={`px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ${mutedClassName}`}>
            Detected extensions
          </p>
          {announced.map((d) => {
            const key = d.info.rdns || d.info.uuid
            return (
              <button
                key={key}
                type="button"
                className="wallet-connect-item"
                onClick={() => void connectInjectedByRdns(d.info.rdns || d.info.uuid)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span>{d.info.name}</span>
                  <span className={mutedClassName}>{d.info.rdns || d.info.uuid}</span>
                </span>
              </button>
            )
          })}
        </>
      ) : null}
      <button type="button" className="wallet-connect-item" onClick={() => onPick('injected')}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>Browser extension (default)</span>
          <span className={mutedClassName}>Uses the wallet your browser exposes as default</span>
        </span>
      </button>
      <button type="button" className="wallet-connect-item" onClick={() => onPick('walletConnect')}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>WalletConnect</span>
          <span className={mutedClassName}>Scan QR with a mobile wallet</span>
        </span>
      </button>
      <div className="wallet-connect-hint">
        <button type="button" className="wallet-connect-auto" onClick={() => onPick('auto')}>
          Auto-detect wallet
        </button>
      </div>
    </>
  )
}
