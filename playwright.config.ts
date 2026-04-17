import { defineConfig } from '@playwright/test'
import { normalizeSmokeBaseUrl } from './src/utils/smokeBaseUrl'

export default defineConfig({
  testDir: 'tests/smoke',
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 75_000 },
  use: {
    baseURL: normalizeSmokeBaseUrl(process.env.SMOKE_BASE_URL),
    trace: 'on-first-retry',
  },
})
