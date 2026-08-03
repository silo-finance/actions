'use client'

type Props = {
  selected: boolean
  onToggle: () => void
}

export default function BlacklistTrashButton({ selected, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle()
      }}
      className={`inline-flex items-center justify-center p-0.5 rounded-md transition-colors ${
        selected
          ? 'text-[var(--silo-danger)] bg-[color-mix(in_srgb,var(--silo-danger)_12%,transparent)]'
          : 'silo-text-faint hover:text-[var(--silo-danger)] hover:bg-[color-mix(in_srgb,var(--silo-danger)_10%,transparent)]'
      }`}
      title={selected ? 'Undo remove selection' : 'Mark for removal'}
      aria-label={selected ? 'Undo remove selection' : 'Mark for removal'}
      aria-pressed={selected}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"
        />
      </svg>
    </button>
  )
}
