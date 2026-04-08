'use client'

import CopyButton from '@/components/CopyButton'
import { getExplorerAddressUrl } from '@/utils/networks'

type Props = {
  /** Zero-based queue index (matches on-chain list position). */
  index: number
  chainId: number
  address: string
  label: string
  /** Vault position in this market (principal asset amount + symbol). */
  positionLabel?: string
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function MarketItem({ index, chainId, address, label, positionLabel }: Props) {
  const explorerUrl = getExplorerAddressUrl(chainId, address)

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 border-b border-[var(--silo-border)] last:border-b-0">
      <span
        className="w-9 shrink-0 text-right text-xs font-mono tabular-nums silo-text-soft select-none"
        title={`Index ${index}`}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <p className="text-sm font-semibold silo-text-main truncate">{label}</p>
          {positionLabel ? (
            <p className="text-xs font-mono tabular-nums silo-text-soft shrink-0" title="Vault position (underlying)">
              {positionLabel}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0 mt-0.5">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono font-semibold silo-text-main hover:underline min-w-0 truncate"
            title={address}
          >
            {shortAddr(address)}
          </a>
          <div className="flex items-center gap-1 shrink-0">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center p-1.5 rounded-md hover:bg-[var(--silo-surface-2)]"
              title="Open in block explorer"
              aria-label="Open in block explorer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
            <CopyButton value={address} />
          </div>
        </div>
      </div>
    </div>
  )
}
