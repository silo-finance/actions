'use client'

type Props = {
  allowed: boolean
  /** Role list after `only:` — use vault role names only: owner, curator, guardian, allocator. */
  onlyForLabel: string
  className?: string
}

export default function ActionPermissionHint({ allowed, onlyForLabel, className = '' }: Props) {
  if (allowed) return null
  return (
    <p className={`text-xs silo-text-soft mt-1.5 leading-snug ${className ?? ''}`.trim()}>
      <span className="font-medium silo-text-soft">only:</span> {onlyForLabel}
    </p>
  )
}
