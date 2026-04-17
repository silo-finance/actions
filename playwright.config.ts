import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/smoke',
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    trace: 'on-first-retry',
  },
})
