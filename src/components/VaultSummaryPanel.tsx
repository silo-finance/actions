'use client'

import type { ReactNode } from 'react'
import CopyButton from '@/components/CopyButton'
import { getExplorerAddressUrl } from '@/utils/networks'
import { formatTimelockSeconds } from '@/utils/timelockFormat'
import type { OwnerKind } from '@/utils/ownerKind'

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function ownerKindLabel(kind: OwnerKind): string {
  switch (kind) {
    case 'eoa':
      return 'EOA (wallet)'
    case 'safe':
      return 'Gnosis Safe (multi-sig)'
    case 'contract':
      return 'Contract (not detected as Safe)'
  }
}

function AddressLine({
  label,
  chainId,
  address,
}: {
  label: string
  chainId: number
  address: string
}) {
  const explorerUrl = getExplorerAddressUrl(chainId, address)
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide silo-text-soft shrink-0 w-28">{label}</span>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-mono font-semibold silo-text-main hover:underline min-w-0 truncate"
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
  )
}

type Props = {
  chainId: number
  vaultAddress: string
  ownerAddress: string
  curatorAddress: string
  guardianAddress: string
  timelockSeconds: bigint
  ownerKind: OwnerKind
  /** Label for the connected wallet’s vault roles (Owner, Curator, …). */
  yourRoleLabel: string
  actions?: ReactNode
}

export default function VaultSummaryPanel({
  chainId,
  vaultAddress,
  ownerAddress,
  curatorAddress,
  guardianAddress,
  timelockSeconds,
  ownerKind,
  yourRoleLabel,
  actions,
}: Props) {
  const { daysText, rawSeconds } = formatTimelockSeconds(timelockSeconds)

  return (
    <div className="silo-panel silo-top-card p-5 mb-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold silo-text-main mb-2">Vault details</h2>
          <div className="divide-y divide-[var(--silo-border)]">
            <AddressLine label="Vault" chainId={chainId} address={vaultAddress} />
            <AddressLine label="Owner" chainId={chainId} address={ownerAddress} />
            <AddressLine label="Curator" chainId={chainId} address={curatorAddress} />
            <AddressLine label="Guardian" chainId={chainId} address={guardianAddress} />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide silo-text-soft shrink-0 w-28">Owner type</span>
              <span className="text-sm silo-text-main">{ownerKindLabel(ownerKind)}</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide silo-text-soft shrink-0 w-28">Timelock</span>
              <span className="text-sm silo-text-main">
                {daysText} <span className="silo-text-soft">({rawSeconds} s)</span>
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide silo-text-soft shrink-0 w-28">Your role</span>
              <span className="text-sm silo-text-main">{yourRoleLabel}</span>
            </div>
          </div>
        </div>
        {actions != null ? (
          <div className="min-w-0 lg:border-l lg:border-[var(--silo-border)] lg:pl-10 pt-6 lg:pt-0 border-t lg:border-t-0 border-[var(--silo-border)]">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
