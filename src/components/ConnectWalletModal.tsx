'use client'

import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useWeb3, type ConnectMethod } from '@/contexts/Web3Context'
import ConnectWalletPanelContent from '@/components/ConnectWalletPanelContent'

type Props = {
  open: boolean
  onClose: () => void
}

export default function ConnectWalletModal({ open, onClose }: Props) {
  const { connect, isConnected } = useWeb3()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  const handlePick = useCallback(
    async (method: ConnectMethod) => {
      await connect(method)
    },
    [connect]
  )

  useEffect(() => {
    if (open && isConnected) onClose()
  }, [open, isConnected, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('.wallet-connect-item')?.focus()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="wallet-connect-modal-root"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="wallet-connect-modal-card wallet-connect-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 id={titleId} className="m-0 text-lg font-bold silo-text-main pr-2">
            Connect wallet
          </h2>
          <button
            type="button"
            className="wallet-connect-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ConnectWalletPanelContent onPick={(m) => void handlePick(m)} />
      </div>
    </div>,
    document.body
  )
}
