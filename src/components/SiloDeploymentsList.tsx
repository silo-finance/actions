'use client'

import { useMemo } from 'react'
import {
  getSiloDeploymentsForChain,
  groupSiloDeployments,
  type SiloDeploymentEntry,
} from '@/config/siloDeploymentsIndex'
import { getNetworkDisplayName } from '@/utils/networks'

type Props = {
  chainId: number
  /** Called with the SiloConfig address when the user clicks a predefined market button. */
  onSelect: (siloConfig: string) => void
  /** Disable clicks while the page is already busy running a check. */
  disabled?: boolean
}

function buttonLabel(entry: SiloDeploymentEntry): string {
  const pair = entry.symbol1 ? `${entry.symbol0}/${entry.symbol1}` : entry.symbol0
  return entry.id != null ? `${pair} #${entry.id}` : pair
}

function SiloButton({
  entry,
  onSelect,
  disabled,
}: {
  entry: SiloDeploymentEntry
  onSelect: (siloConfig: string) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(entry.siloConfig)}
      title={`${entry.rawKey} — ${entry.siloConfig}`}
      data-test={entry.isTest ? 'true' : 'false'}
      className="
        inline-flex items-center rounded-md border border-[var(--silo-border)]
        bg-[var(--silo-surface)] px-2 py-1 text-xs font-medium silo-text-main
        hover:border-[var(--silo-text-main,currentColor)]
        data-[test=true]:opacity-80
        disabled:opacity-50 disabled:cursor-not-allowed
      "
    >
      {buttonLabel(entry)}
    </button>
  )
}

export default function SiloDeploymentsList({ chainId, onSelect, disabled }: Props) {
  /**
   * Only V3 markets are exposed as predefined buttons (id >= 3000). V2 deployments are
   * intentionally hidden — the input still accepts them if needed.
   */
  const v3Entries = useMemo(() => {
    const entries = getSiloDeploymentsForChain(chainId)
    return groupSiloDeployments(entries).v3
  }, [chainId])

  const chainLabel = getNetworkDisplayName(chainId) ?? `chain ${chainId}`

  if (v3Entries.length === 0) {
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

  return (
    <div className="silo-panel p-4 mb-6 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">
        Predefined silos on {chainLabel}
        <span className="ml-2 silo-text-soft font-normal">({v3Entries.length})</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {v3Entries.map((entry) => (
          <SiloButton
            key={entry.siloConfig}
            entry={entry}
            onSelect={onSelect}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}
