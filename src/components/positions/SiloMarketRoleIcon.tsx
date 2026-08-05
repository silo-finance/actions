import type { SiloMarketRole } from '@/utils/siloMarketRole'

const ROLE_LABEL: Record<SiloMarketRole, string> = {
  collateral: 'collateral silo',
  debt: 'debt silo',
  'two-way': 'two-way market',
}

function LockIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowUpRightIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path d="M7 17L17 7" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7h8v8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowLeftRightIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path d="M8 7H20M16 3l4 4-4 4" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 17H4M8 13l-4 4 4 4" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function SiloMarketRoleIcon({ role }: { role: SiloMarketRole }) {
  const label = ROLE_LABEL[role]
  return (
    <span className="inline-flex shrink-0 silo-text-soft" title={label} aria-label={label}>
      {role === 'collateral' ? <LockIcon /> : null}
      {role === 'debt' ? <ArrowUpRightIcon /> : null}
      {role === 'two-way' ? <ArrowLeftRightIcon /> : null}
    </span>
  )
}
