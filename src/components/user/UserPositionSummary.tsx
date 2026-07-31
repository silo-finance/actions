'use client'

import CopyButton from '@/components/CopyButton'
import { getExplorerAddressUrl } from '@/utils/networks'
import {
  formatWadPercent,
  type SolvencyConfigSummary,
  type UserSiloPosition,
} from '@/utils/userSiloReader'

type Props = {
  chainId: number
  position: UserSiloPosition
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function siloLabel(base: string, siloIndex: number | null): string {
  return siloIndex != null ? `${base} (Silo ${siloIndex})` : base
}

const ROLE_LABEL: Record<UserSiloPosition['role'], string> = {
  BORROWER: 'Borrower',
  LENDER: 'Lender',
  NO_POSITION: 'No position',
}

const PILL_BASE = 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border'
const PILL_GREEN =
  'border-[color-mix(in_srgb,var(--silo-signal-green)_45%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-signal-green)_22%,var(--silo-surface))] text-[var(--silo-text)]'
const PILL_DANGER =
  'border-[color-mix(in_srgb,var(--silo-danger)_45%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-danger)_14%,var(--silo-surface))] text-[color-mix(in_srgb,var(--silo-danger)_70%,var(--silo-text))]'
const PILL_WARNING =
  'border-[color-mix(in_srgb,var(--silo-warning)_50%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-warning)_14%,var(--silo-surface))] text-[color-mix(in_srgb,var(--silo-warning)_55%,var(--silo-text))]'
const PILL_NEUTRAL = 'border-[var(--silo-border)] bg-[var(--silo-surface)] text-[var(--silo-text-main)]'

function AddressLink({ chainId, address }: { chainId: number; address: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={getExplorerAddressUrl(chainId, address)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs silo-text-main hover:underline"
        title={address}
      >
        {shortAddress(address)}
      </a>
      <CopyButton value={address} />
    </span>
  )
}

function SiloRef({
  chainId,
  config,
  symbol,
}: {
  chainId: number
  config: SolvencyConfigSummary
  symbol: string | null
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {symbol ? <span className="text-sm font-semibold silo-text-main">{symbol}</span> : null}
      <a
        href={getExplorerAddressUrl(chainId, config.token)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs silo-text-soft hover:underline"
        title={config.token}
      >
        {shortAddress(config.token)}
      </a>
      <CopyButton value={config.token} />
    </span>
  )
}

function liveLtvWarning(position: UserSiloPosition): string | null {
  if (position.role !== 'BORROWER' || position.ltv != null) return null
  if (!position.lensAddress) {
    return 'Silo Lens is not available on this chain, so live LTV could not be read.'
  }
  if (position.ltvReadError) {
    return `Live LTV could not be read: ${position.ltvReadError}`
  }
  return 'Live LTV could not be read.'
}

export default function UserPositionSummary({ chainId, position }: Props) {
  const { role, siloId, isSolvent, ltv, lt, collateralConfig, debtConfig } = position
  const ltvWarning = liveLtvWarning(position)

  const symbolForToken = (token: string): string | null =>
    position.silos.find((s) => s.token.toLowerCase() === token.toLowerCase())?.symbol ?? null

  const siloIndexForAddress = (addr: string): number | null => {
    const i = position.silos.findIndex((s) => s.silo.toLowerCase() === addr.toLowerCase())
    return i >= 0 ? i : null
  }

  const rolePill = role === 'BORROWER' ? PILL_WARNING : role === 'LENDER' ? PILL_GREEN : PILL_NEUTRAL

  /**
   * A borrow can be backed by collateral in the same silo as the debt ("one asset") or in the
   * paired silo ("two assets"). `getConfigsForSolvency` returns both sides, so equal silo addresses
   * mean a single-asset position.
   */
  const positionType =
    role === 'BORROWER' && collateralConfig && debtConfig
      ? collateralConfig.silo.toLowerCase() === debtConfig.silo.toLowerCase()
        ? 'One asset position'
        : 'Two assets position'
      : null

  return (
    <div className="silo-panel p-5 mb-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className={`${PILL_BASE} ${rolePill} uppercase tracking-wide`}>{ROLE_LABEL[role]}</span>
        {siloId != null ? <span className="text-sm font-bold silo-text-main">Silo #{siloId}</span> : null}
        {isSolvent != null ? (
          <span className={`${PILL_BASE} ${isSolvent ? PILL_GREEN : PILL_DANGER}`}>
            {isSolvent ? 'Solvent' : 'Insolvent'}
          </span>
        ) : null}
        {positionType ? <span className={`${PILL_BASE} ${PILL_NEUTRAL}`}>{positionType}</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs font-semibold uppercase tracking-wide silo-text-soft">User</span>
        <AddressLink chainId={chainId} address={position.user} />
      </div>

      {role === 'BORROWER' ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Metric
            label="LTV"
            value={ltv != null ? formatWadPercent(ltv) : '—'}
            hint="Current loan-to-value: borrowed value / collateral value."
          />
          <Metric
            label="LT"
            value={lt != null ? formatWadPercent(lt) : collateralConfig ? formatWadPercent(collateralConfig.lt) : '—'}
            hint="Liquidation Threshold: LTV at which the position becomes liquidatable (insolvent)."
          />
          <Metric
            label="Target LTV"
            value={collateralConfig ? formatWadPercent(collateralConfig.liquidationTargetLtv) : '—'}
            hint="Liquidation target LTV: the LTV a partial liquidation aims to restore the position to."
          />
          <Metric
            label="Max LTV"
            value={collateralConfig ? formatWadPercent(collateralConfig.maxLtv) : '—'}
            hint="Maximum LTV allowed when opening or increasing a borrow."
          />
          {collateralConfig ? (
            <div className="col-span-2">
              <p className="text-xs silo-text-soft mb-1">{siloLabel('Collateral silo', siloIndexForAddress(collateralConfig.silo))}</p>
              <SiloRef chainId={chainId} config={collateralConfig} symbol={symbolForToken(collateralConfig.token)} />
            </div>
          ) : null}
          {debtConfig ? (
            <div className="col-span-2">
              <p className="text-xs silo-text-soft mb-1">{siloLabel('Debt silo', siloIndexForAddress(debtConfig.silo))}</p>
              <SiloRef chainId={chainId} config={debtConfig} symbol={symbolForToken(debtConfig.token)} />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm silo-text-soft m-0">
          {role === 'LENDER'
            ? 'Deposit-only position. Health metrics (LTV, LT) apply to borrowers.'
            : 'This user has no protected, collateral, or debt position in this market.'}
        </p>
      )}

      {ltvWarning ? <p className="mt-3 text-sm silo-alert silo-alert-warning">{ltvWarning}</p> : null}
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs silo-text-soft mb-1 cursor-help" title={hint}>
        {label}
      </p>
      <p className="text-base font-bold silo-text-main m-0 tabular-nums">{value}</p>
    </div>
  )
}
