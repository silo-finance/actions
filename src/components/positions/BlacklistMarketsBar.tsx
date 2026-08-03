'use client'

import Image from 'next/image'
import {
  buildBlacklistClipboardPayload,
  getBlacklistSilosWorkflowUrl,
  type BlacklistClipboardMarket,
} from '@/utils/githubActions'

export type BlacklistBarItem = BlacklistClipboardMarket & {
  chainId: number
  siloId: number | null
  tokenSymbol: string | null
  chainIconPath: string | null
  chainDisplayName: string
}

type Props = {
  items: BlacklistBarItem[]
  onClear: () => void
  onRemoveItem: (key: string) => void
  copyToClipboard: (value: string) => Promise<boolean>
}

function itemKey(item: BlacklistBarItem): string {
  return `${item.chainId}:${item.siloAddress.toLowerCase()}`
}

export default function BlacklistMarketsBar({ items, onClear, onRemoveItem, copyToClipboard }: Props) {
  if (items.length === 0) return null

  const handleConfirm = async () => {
    const payload = buildBlacklistClipboardPayload(
      items.map((item) => ({
        chainKey: item.chainKey,
        siloAddress: item.siloAddress.toLowerCase(),
      }))
    )
    await copyToClipboard(payload)
    window.open(getBlacklistSilosWorkflowUrl(), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(100vw-2rem,22rem)] pointer-events-auto">
      <div className="silo-panel shadow-lg border border-[var(--silo-border)] p-3 sm:p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="m-0 text-sm font-semibold silo-text-main">Remove markets</p>
            <p className="m-0 mt-0.5 text-xs silo-text-soft">
              {items.length} selected. After Confirm, paste the clipboard into the{' '}
              <span className="font-mono silo-text-main">config</span> field on the Blacklist Silos
              action, then run the workflow.
            </p>
          </div>
          <button
            type="button"
            className="silo-inline-dismiss leading-none"
            onClick={onClear}
            aria-label="Clear blacklist selection"
            title="Clear selection"
          >
            ×
          </button>
        </div>

        <ul className="m-0 p-0 list-none max-h-40 overflow-y-auto space-y-1.5">
          {items.map((item) => (
            <li
              key={itemKey(item)}
              className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5 bg-[color-mix(in_srgb,var(--silo-soft-purple)_22%,var(--silo-surface))]"
            >
              {item.chainIconPath ? (
                <Image
                  src={item.chainIconPath}
                  alt={`${item.chainDisplayName} icon`}
                  width={14}
                  height={14}
                  className="rounded-sm shrink-0"
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <span className="silo-text-soft shrink-0">#{item.siloId ?? '—'}</span>
              <span className="font-medium silo-text-main truncate">{item.tokenSymbol ?? '?'}</span>
              <button
                type="button"
                className="ml-auto text-[var(--silo-danger)] text-base leading-none px-1"
                onClick={() => onRemoveItem(itemKey(item))}
                aria-label={`Remove ${item.tokenSymbol ?? item.siloAddress} from selection`}
                title="Remove from selection"
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <button type="button" className="silo-btn-secondary flex-1" onClick={onClear}>
            Clear
          </button>
          <button type="button" className="silo-btn-primary flex-1" onClick={() => void handleConfirm()}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
