'use client'

import type { ReactNode } from 'react'
import MarketItem from '@/components/MarketItem'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import { DUST_HELP_TOOLTIP, isWithdrawMarketDustPosition } from '@/utils/withdrawMarketDust'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

/** Per-row selection state — lets the parent drive eligibility + single-vs-multi behavior. */
export type QueueRowSelection = {
  /** Zero-based queue indexes currently selected. */
  selected: ReadonlySet<number>
  /**
   * Called when the user toggles the checkbox on row `index`. The column is intentionally
   * UI-only — the parent decides whether to replace (single-select) or add/remove (multi-select).
   */
  onToggle: (index: number) => void
  /**
   * Per-row state driven by the parent:
   * - `disabled` + `reason` gate the checkbox and provide the tooltip.
   * - `inlineReason` renders a muted line under the row (default: on-chain blockers).
   * - `inlineWarning` renders a yellow warning line, typically when the user just made a
   *   selection that will execute immediately (e.g. a market already past its forced-removal timelock).
   */
  rowState?: (index: number) => {
    disabled: boolean
    reason?: string
    inlineReason?: string
    inlineWarning?: string
  }
  ariaLabel?: string
}

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
  /** Opt-in selection column rendered to the left of each row. */
  selection?: QueueRowSelection
  /** Optional footer slot rendered inside the panel (e.g. a Submit Market Removal action). */
  footer?: ReactNode
}

export default function QueueColumn({
  title,
  count,
  chainId,
  items,
  queueStates,
  loading,
  emptyMessage = 'No markets',
  selection,
  footer,
}: Props) {
  const heading = count !== undefined ? `${title} (${count})` : title
  const statesForItems =
    queueStates != null && queueStates.length === items.length ? queueStates : undefined

  return (
    <div className="silo-panel silo-top-card p-5 h-full min-h-[200px] flex flex-col">
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
            const marketItem = (
              <MarketItem
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
            if (!selection) return <div key={`${m.address}-${i}`}>{marketItem}</div>

            const rowState = selection.rowState?.(i) ?? { disabled: false }
            const isSelected = selection.selected.has(i)
            const inputId = `queue-select-${i}-${m.address}`
            return (
              <div key={`${m.address}-${i}`} className="min-w-0">
                <div className="flex items-stretch gap-2 min-w-0">
                  <label
                    htmlFor={inputId}
                    className={`flex items-center pl-1 pr-2 shrink-0 select-none ${
                      rowState.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    }`}
                    title={rowState.reason}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={isSelected}
                      disabled={rowState.disabled}
                      onChange={() => selection.onToggle(i)}
                      aria-label={selection.ariaLabel ?? `Select market ${m.label}`}
                      className="h-4 w-4 rounded border-[var(--silo-border)] silo-text-main disabled:cursor-not-allowed"
                    />
                  </label>
                  <div className="min-w-0 flex-1">{marketItem}</div>
                </div>
                {rowState.inlineWarning ? (
                  <p
                    className="ml-7 mt-0.5 mb-1 text-xs font-medium leading-snug"
                    style={{ color: 'var(--silo-warning)' }}
                  >
                    {rowState.inlineWarning}
                  </p>
                ) : rowState.inlineReason ? (
                  <p className="ml-7 mt-0.5 mb-1 text-xs silo-text-soft leading-snug">
                    {rowState.inlineReason}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {footer ? <div className="mt-auto pt-4">{footer}</div> : null}
    </div>
  )
}
