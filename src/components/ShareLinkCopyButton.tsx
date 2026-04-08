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
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center justify-center p-1.5 rounded-md hover:bg-[var(--silo-surface-2)] ${className}`}
      title={copied ? 'Copied' : 'Copy link'}
      aria-label="Copy link"
    >
      {copied ? (
        <span className="text-[10px] font-semibold text-[var(--silo-signal-green)]">OK</span>
      ) : (
        <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
          />
        </svg>
      )}
    </button>
  )
}
