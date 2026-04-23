'use client'

import { useEffect, useState } from 'react'
import { getNetworkDisplayName } from '@/utils/networks'
import { fetchEarnSilosForChain, type EarnSiloEntry } from '@/utils/siloEarnSilosApi'

type Props = {
  chainId: number
  /**
   * Called with the SiloConfig address and a `siloAddressLc -> symbol` map (covers silo0 and
   * silo1 when the API returned both symbols) so downstream code can skip `ERC20.symbol()`.
   */
  onSelect: (siloConfig: string, symbolOverrides: Record<string, string>) => void
  /** Disable clicks while the page is already busy running a check. */
  disabled?: boolean
}

function buttonLabel(entry: EarnSiloEntry): string {
  const sym0 = entry.symbol0 ?? '?'
  const sym1 = entry.symbol1 ?? '?'
  /**
   * Non-breaking spaces (U+00A0) around the slash keep `symbol / symbol #id` on one line —
   * `flex-wrap` on the container otherwise loves to break `wstETH / WETH` at the slash because
   * of the regular space.
   */
  const pair = `${sym0}\u00A0/\u00A0${sym1}`
  return entry.siloId != null ? `${pair} #${entry.siloId}` : pair
}

function buildOverrides(entry: EarnSiloEntry): Record<string, string> {
  const out: Record<string, string> = {}
  if (entry.symbol0) out[entry.silo0.toLowerCase()] = entry.symbol0
  if (entry.symbol1) out[entry.silo1.toLowerCase()] = entry.symbol1
  return out
}

function SiloButton({
  entry,
  onSelect,
  disabled,
}: {
  entry: EarnSiloEntry
  onSelect: Props['onSelect']
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(entry.siloConfig, buildOverrides(entry))}
      title={`${entry.name || buttonLabel(entry)} — ${entry.siloConfig}`}
      className="
        inline-flex items-center whitespace-nowrap rounded-md border border-[var(--silo-border)]
        bg-[var(--silo-surface)] px-2 py-1 text-xs font-medium silo-text-main
        hover:border-[var(--silo-text-main,currentColor)]
        disabled:opacity-50 disabled:cursor-not-allowed
      "
    >
      {buttonLabel(entry)}
    </button>
  )
}

export default function SiloDeploymentsList({ chainId, onSelect, disabled }: Props) {
  const [entries, setEntries] = useState<EarnSiloEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Free-text filter — matched case-insensitively against the rendered button label (which
   * already contains the symbols and the `#id`), so the user can type either a token symbol
   * (`WETH`), an id fragment (`3006`), or any substring of the full `sym / sym #id` string.
   */
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setEntries(null)
    setFilter('')

    fetchEarnSilosForChain(chainId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        /**
         * V3-only picker: `siloId >= 3000` matches the id range used in the old snapshot's
         * `_id_<N>` suffixes. Sort by id ascending first, then name alphabetically so the
         * order stays stable across re-renders.
         */
        const v3 = rows
          .filter((r) => r.siloId != null && r.siloId >= 3000)
          .sort((a, b) => {
            const byId = (a.siloId ?? 0) - (b.siloId ?? 0)
            if (byId !== 0) return byId
            return (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase())
          })
        setEntries(v3)
      })
      .catch((e) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
      })

    return () => controller.abort()
  }, [chainId])

  const chainLabel = getNetworkDisplayName(chainId) ?? `chain ${chainId}`

  if (loading && entries == null) {
    return (
      <div className="silo-panel p-4 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
          Predefined silos
        </p>
        <p className="text-sm silo-text-soft m-0">Loading predefined silos on {chainLabel}…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="silo-panel p-4 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
          Predefined silos
        </p>
        <p className="text-sm silo-alert silo-alert-error m-0">
          Failed to load predefined silos for {chainLabel}: {error}
        </p>
      </div>
    )
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="silo-panel p-4 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-1">
          Predefined silos
        </p>
        <p className="text-sm silo-text-soft m-0">
          No predefined V3 silos listed for {chainLabel}.
        </p>
      </div>
    )
  }

  /**
   * Normalize spacing in the query *and* the label before matching so typing `wstETH/WETH` or
   * `wsteth / weth` still hits `wstETH\u00A0/\u00A0WETH #3006`. We strip every whitespace run —
   * including the NBSPs we inject around the slash — so any single/multiple space the user types
   * is equivalent to no space at all.
   */
  const needle = filter.trim().toLowerCase().replace(/\s+/g, '')
  const filtered = needle
    ? entries.filter((entry) =>
        buttonLabel(entry).toLowerCase().replace(/\s+/g, '').includes(needle)
      )
    : entries

  return (
    <div className="silo-panel p-4 mb-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">
          Predefined silos on {chainLabel}
          <span className="ml-2 silo-text-soft font-normal">
            ({needle ? `${filtered.length}/${entries.length}` : entries.length})
          </span>
        </p>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by symbol or #id"
          aria-label="Filter predefined silos"
          className="silo-input silo-input--md text-sm w-full sm:w-56"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm silo-text-soft m-0">No markets match “{filter}”.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {filtered.map((entry) => (
            <SiloButton
              key={entry.siloConfig}
              entry={entry}
              onSelect={onSelect}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}
