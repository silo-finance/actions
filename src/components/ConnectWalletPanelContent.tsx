'use client'

import type { ConnectMethod } from '@/contexts/Web3Context'

type Props = {
  onPick: (method: ConnectMethod) => void
  /** Muted helper line uses header tokens in bar, theme tokens in modal */
  mutedClassName?: string
}

export default function ConnectWalletPanelContent({
  onPick,
  mutedClassName = 'text-xs font-medium silo-text-soft',
}: Props) {
  return (
    <>
      <p className="wallet-connect-label">Connect with</p>
      <p className={`px-2 -mt-0.5 pb-1 leading-snug ${mutedClassName}`}>
        Browser extension or WalletConnect. Large targets for quick access.
      </p>
      <button type="button" className="wallet-connect-item" onClick={() => onPick('injected')}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span>Browser extension</span>
          <span className={mutedClassName}>MetaMask, Rabby, Brave, and similar</span>
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
