'use client'

import { useEffect } from 'react'

type AppRuntimeErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AppRuntimeError({ error, reset }: AppRuntimeErrorProps) {
  useEffect(() => {
    // Stable console prefix for smoke/debug logs.
    console.error('[app-runtime-error]', error)
  }, [error])

  const digest = error.digest?.trim() || 'n/a'
  const message = error.message?.trim() || 'Unknown runtime error'

  return (
    <div className="silo-page px-4 py-8 sm:px-6 max-w-4xl mx-auto">
      <div
        data-testid="app-runtime-error"
        className="silo-panel silo-top-card p-6"
      >
        <p className="text-xs font-semibold tracking-wide uppercase silo-text-soft m-0">Application render error</p>
        <h1 className="text-2xl font-bold silo-text-main mt-2 mb-2">APP-500: UI render failed</h1>
        <p className="text-sm silo-text-main m-0">
          The app returned HTTP 200, but client rendering failed. See details below.
        </p>

        <div className="mt-4 text-sm">
          <p className="m-0 silo-alert silo-alert-error">
            <strong>Error:</strong> {message}
          </p>
          <p className="m-0 mt-2 silo-alert silo-alert-warning">
            <strong>Digest:</strong> {digest}
          </p>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold silo-text-main">Show stack/details</summary>
          <pre className="mt-3 text-xs whitespace-pre-wrap break-words rounded p-3 bg-[var(--silo-surface-2)] silo-text-main border border-[var(--silo-border)]">
            {error.stack || String(error)}
          </pre>
        </details>

        <div className="mt-5">
          <button type="button" onClick={() => reset()} className="silo-btn-secondary text-sm">
            Try to recover
          </button>
        </div>
      </div>
    </div>
  )
}
