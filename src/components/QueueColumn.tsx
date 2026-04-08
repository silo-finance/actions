'use client'

import MarketItem from '@/components/MarketItem'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'

type Props = {
  title: string
  /** When set, shown as `Title (n)` — number of markets in the queue. */
  count?: number
  chainId: number
  items: ResolvedMarket[]
  loading?: boolean
  emptyMessage?: string
}

export default function QueueColumn({
  title,
  count,
  chainId,
  items,
  loading,
  emptyMessage = 'No markets',
}: Props) {
  const heading = count !== undefined ? `${title} (${count})` : title

  return (
    <div className="silo-panel silo-top-card p-5 h-full min-h-[200px]">
      <h2 className="text-lg font-semibold silo-text-main mb-3">{heading}</h2>
      {loading ? (
        <p className="text-sm silo-text-soft">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm silo-text-soft">{emptyMessage}</p>
      ) : (
        <div>
          {items.map((m, i) => (
            <MarketItem
              key={`${m.address}-${i}`}
              index={i}
              chainId={chainId}
              address={m.address}
              label={m.label}
              positionLabel={m.positionLabel}
            />
          ))}
        </div>
      )}
    </div>
  )
}
