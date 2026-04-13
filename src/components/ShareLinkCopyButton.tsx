'use client'

import { useState } from 'react'

type Props = {
  url: string
  className?: string
  iconClassName?: string
}

/** Copies a URL; share-style icon for link sharing. */
export default function ShareLinkCopyButton({
  url,
  className = '',
  iconClassName = 'w-4 h-4',
}: Props) {
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center rounded-full border border-[var(--silo-border)] bg-transparent p-1.5 text-[var(--silo-text-soft)] transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--silo-accent)_45%,var(--silo-border))] hover:text-[var(--silo-text)] ${className}`}
        title={copied ? 'Copied' : 'Copy link'}
        aria-label="Copy link"
      >
        <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      </button>
      <span
        aria-live="polite"
        className={`pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-[color-mix(in_srgb,var(--silo-signal-green)_55%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-mint-accent)_72%,var(--silo-surface))] px-2 py-0.5 text-xs font-semibold text-[var(--silo-text)] shadow-sm transition-opacity duration-200 ${
          copied ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Copied
      </span>
    </span>
  )
}
