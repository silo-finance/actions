'use client'

/**
 * TEMPORARY: intentional client-only render crash for validating Pages rollback.
 * SSG/build and HTTP 200 stay OK; the browser throws after hydration.
 * Remove this import from `src/app/page.tsx` and delete this file after the test.
 */
export function RollbackTestClientCrash() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Rollback test: intentional client render crash (revert after validating auto-rollback).',
    )
  }
  return null
}
