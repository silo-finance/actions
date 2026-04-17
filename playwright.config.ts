import { defineConfig } from '@playwright/test'

/** GitHub Pages project URL is a path under the host; baseURL must not end with `/` so `goto('./')` resolves in-repo. */
function smokeBaseUrl(): string | undefined {
  const raw = process.env.SMOKE_BASE_URL?.trim()
  if (!raw) return undefined
  return raw.replace(/\/+$/, '')
}

export default defineConfig({
  testDir: 'tests/smoke',
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 75_000 },
  use: {
    baseURL: smokeBaseUrl(),
    trace: 'on-first-retry',
  },
})
