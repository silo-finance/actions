'use client'

import { useState } from 'react'

type Props = {
  value: string
  className?: string
  iconClassName?: string
}

export default function CopyButton({ value, className = '', iconClassName = 'w-3.5 h-3.5' }: Props) {
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(value)
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
      className={`inline-flex items-center justify-center p-1 rounded-md hover:bg-[var(--silo-surface-2)] ${className}`}
      title={copied ? 'Copied' : 'Copy address'}
      aria-label="Copy address"
    >
      {copied ? (
        <span className="text-[10px] font-semibold text-[var(--silo-signal-green)]">OK</span>
      ) : (
        <svg className={iconClassName} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  )
}
