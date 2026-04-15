'use client'

import MarketItem from '@/components/MarketItem'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import { DUST_HELP_TOOLTIP, isWithdrawMarketDustPosition } from '@/utils/withdrawMarketDust'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

type Props = {
  title: string
  /** When set, shown as `Title (n)` — number of markets in the queue. */
  count?: number
  chainId: number
  items: ResolvedMarket[]
  /** When same length as `items`, used for dust detection on withdraw queue rows. */
  queueStates?: WithdrawMarketOnchainState[]
  loading?: boolean
  emptyMessage?: string
}

export default function QueueColumn({
  title,
  count,
  chainId,
  items,
  queueStates,
  loading,
  emptyMessage = 'No markets',
}: Props) {
  const heading = count !== undefined ? `${title} (${count})` : title
  const statesForItems =
    queueStates != null && queueStates.length === items.length ? queueStates : undefined

  return (
    <div className="silo-panel silo-top-card p-5 h-full min-h-[200px]">
      <h2 className="text-lg font-semibold silo-text-main mb-3">{heading}</h2>
      {loading ? (
        <p className="text-sm silo-text-soft">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm silo-text-soft">{emptyMessage}</p>
      ) : (
        <div>
          {items.map((m, i) => {
            const st = statesForItems?.[i]
            const dust = st != null && isWithdrawMarketDustPosition(st)
            return (
              <MarketItem
                key={`${m.address}-${i}`}
                index={i}
                chainId={chainId}
                address={m.address}
                label={m.label}
                positionLabel={dust ? undefined : m.positionLabel}
                positionIsDust={dust}
                dustHelpText={dust ? DUST_HELP_TOOLTIP : undefined}
                siloConfigId={m.siloConfigId}
                capLabel={m.capLabel}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
