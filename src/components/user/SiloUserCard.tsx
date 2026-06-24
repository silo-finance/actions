'use client'

import CopyButton from '@/components/CopyButton'
import { formatAssetAmount } from '@/utils/liquidationRpc'
import { getExplorerAddressUrl } from '@/utils/networks'
import type { SiloUserData } from '@/utils/userSiloReader'

type Props = {
  chainId: number
  label: string
  data: SiloUserData
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

const SECTION_BOX =
  'rounded-2xl border border-[color-mix(in_srgb,var(--silo-accent)_24%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-accent-soft)_12%,var(--silo-surface))] p-4 space-y-2.5'
const SECTION_HEADING =
  'text-[11px] font-bold uppercase tracking-wide m-0 text-[color-mix(in_srgb,var(--silo-accent)_82%,var(--silo-text))]'

function AmountRow({ label, value, decimals, symbol }: { label: string; value: bigint; decimals: number; symbol: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium silo-text-soft">{label}</span>
      <span className="text-sm font-bold silo-text-main tabular-nums">
        {formatAssetAmount(value, decimals)}
        {symbol ? <span className="font-medium silo-text-soft"> {symbol}</span> : null}
      </span>
    </div>
  )
}

export default function SiloUserCard({ chainId, label, data }: Props) {
  const { silo, token, symbol, decimals, marketTotals, userPosition } = data
  return (
    <div className="silo-panel p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold silo-text-main">{label}</span>
        {symbol ? (
          <span className="inline-flex items-center rounded-full border border-[var(--silo-border)] bg-[var(--silo-surface)] px-2 py-0.5 text-xs font-semibold silo-text-main">
            {symbol}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <a
            href={getExplorerAddressUrl(chainId, silo)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs silo-text-soft hover:underline"
            title={silo}
          >
            {shortAddress(silo)}
          </a>
          <CopyButton value={silo} />
        </span>
      </div>

      <div className={SECTION_BOX}>
        <p className={SECTION_HEADING}>Market totals</p>
        <AmountRow label="Total Assets" value={marketTotals.totalAssets} decimals={decimals} symbol={symbol} />
        <AmountRow label="Total Debt" value={marketTotals.totalDebt} decimals={decimals} symbol={symbol} />
        <AmountRow label="Total Protected" value={marketTotals.totalProtected} decimals={decimals} symbol={symbol} />
      </div>

      <div className={SECTION_BOX}>
        <p className={SECTION_HEADING}>User position</p>
        <AmountRow label="Protected" value={userPosition.protectedAssets} decimals={decimals} symbol={symbol} />
        <AmountRow label="Collateral" value={userPosition.collateralAssets} decimals={decimals} symbol={symbol} />
        <AmountRow label="Debt" value={userPosition.debtAssets} decimals={decimals} symbol={symbol} />
      </div>

      {token === '0x0000000000000000000000000000000000000000' ? (
        <p className="text-xs silo-alert silo-alert-warning m-0">Could not read this silo&apos;s asset.</p>
      ) : null}
    </div>
  )
}
