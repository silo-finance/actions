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
  /** `SiloConfig.SILO_ID()` for Silo markets. */
  siloConfigId?: bigint
  /** Vault supply cap (whole underlying tokens), from queue load. */
  capLabel?: string
  /** When set, replaces the index column with up/down controls. */
  reorder?: { onUp: () => void; onDown: () => void; disableUp: boolean; disableDown: boolean }
  /** Highlight row (e.g. market added in this session before the next Check). */
  highlightNew?: boolean
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function MarketItem({
  index,
  chainId,
  address,
  label,
  positionLabel,
  siloConfigId,
  capLabel,
  reorder,
  highlightNew,
}: Props) {
  const explorerUrl = getExplorerAddressUrl(chainId, address)

  return (
    <div
      className={`flex flex-wrap items-center gap-2 py-2 border-b border-[var(--silo-border)] last:border-b-0 ${
        highlightNew ? 'silo-market-row--new' : ''
      }`}
    >
      {reorder ? (
        <div className="w-9 shrink-0 flex flex-col items-center gap-0.5 select-none" title={`Position ${index + 1}`}>
          <button
            type="button"
            aria-label="Move up"
            disabled={reorder.disableUp}
            onClick={reorder.onUp}
            className="silo-btn-icon leading-none text-[10px] font-semibold"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={reorder.disableDown}
            onClick={reorder.onDown}
            className="silo-btn-icon leading-none text-[10px] font-semibold"
          >
            ↓
          </button>
        </div>
      ) : (
        <span
          className="w-9 shrink-0 text-right text-xs font-mono tabular-nums silo-text-soft select-none"
          title={`Index ${index}`}
        >
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <p className="text-sm font-semibold silo-text-main truncate shrink-0">{label}</p>
          {siloConfigId !== undefined ? (
            <span
              className="text-sm font-mono tabular-nums silo-text-soft shrink-0"
              title="Silo config ID"
            >
              #{siloConfigId.toString()}
            </span>
          ) : null}
          {positionLabel ? (
            <p className="text-xs shrink-0 min-w-0" title="Vault position (underlying)">
              <span className="silo-text-soft">balance </span>
              <span className="font-mono tabular-nums silo-text-main">{positionLabel}</span>
            </p>
          ) : null}
          {capLabel ? (
            <p className="text-xs shrink-0 min-w-0" title="Vault supply cap (whole underlying tokens)">
              <span className="silo-text-soft">(cap </span>
              <span className="font-mono tabular-nums silo-text-main">{capLabel}</span>
              <span className="silo-text-soft">)</span>
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
