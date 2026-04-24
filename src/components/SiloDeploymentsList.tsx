'use client'

import { useEffect, useState } from 'react'
import { getNetworkDisplayName } from '@/utils/networks'
import { fetchEarnSilosForChain, type EarnSiloEntry } from '@/utils/siloEarnSilosApi'

type Props = {
  chainId: number
  /**
   * Called with the SiloConfig address and a `tokenAddressLc -> symbol` map (covers the earn
   * token + collateral token when both came back from `/api/earn-silos`) so the downstream
   * reader can resolve symbols without issuing an extra `ERC20.symbol()` multicall.
   */
  onSelect: (siloConfig: string, symbolOverrides: Record<string, string>) => void
  /** Disable clicks while the page is already busy running a check. */
  disabled?: boolean
}

function buttonLabel(entry: EarnSiloEntry): string {
  const sym0 = entry.tokenSymbol ?? '?'
  const sym1 = entry.collateralTokenSymbol ?? '?'
  /**
   * `symbol / symbol, #id` — NBSP around `/` and after the comma so the label stays on one line.
   * Numeric id from v3 GraphQL (`siloId`); if missing (indexer gap / GQL error), only the pair is shown.
   */
  const pair = `${sym0}\u00A0/\u00A0${sym1}`
  if (entry.siloId != null) {
    return `${pair},\u00A0#${entry.siloId}`
  }
  return pair
}

/**
 * Token-keyed (not silo-keyed): `/api/earn-silos` exposes only the earn-side silo address so we
 * cannot pre-fill both silos by address, but it does give us *both* token addresses + symbols.
 * `readSiloConfigEntries` dedupes by token when calling `ERC20.symbol()`, so a token map is the
 * cleanest shortcut and covers both silos of the pair.
 */
function buildOverrides(entry: EarnSiloEntry): Record<string, string> {
  const out: Record<string, string> = {}
  if (entry.tokenAddress && entry.tokenSymbol) {
    out[entry.tokenAddress.toLowerCase()] = entry.tokenSymbol
  }
  if (entry.collateralTokenAddress && entry.collateralTokenSymbol) {
    out[entry.collateralTokenAddress.toLowerCase()] = entry.collateralTokenSymbol
  }
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
   * already contains both asset symbols), so the user can type any substring of `sym / sym`.
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
        /** `fetchEarnSilosForChain` already sorts by numeric `siloId` then name. */
        setEntries(rows)
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
          No predefined silos listed for {chainLabel}.
        </p>
      </div>
    )
  }

  /**
   * Normalize spacing in the query *and* the label before matching so typing `wstETH/WETH` or
   * `wsteth / weth` still hits `wstETH\u00A0/\u00A0WETH`. We strip every whitespace run —
   * including the NBSPs we inject around the slash — so single/multiple spaces the user types
   * are all equivalent.
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
