import { loadEnvConfig } from '@next/env'
import { defineConfig } from '@playwright/test'
import { normalizeSmokeBaseUrl } from './tests/utils/smokeBaseUrl'

// Same env files as `next dev`: `.env.local`, `.env.development`, etc.
// Playwright does not load them automatically; `@next/env` also skips `.env.local` when NODE_ENV=test.
const nodeEnvBefore = process.env.NODE_ENV
if (nodeEnvBefore === 'test') {
  Reflect.deleteProperty(process.env, 'NODE_ENV')
}
loadEnvConfig(process.cwd(), true)
if (nodeEnvBefore !== undefined) {
  Reflect.set(process.env, 'NODE_ENV', nodeEnvBefore)
}

export default defineConfig({
  testDir: 'tests/smoke',
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 150_000,
  expect: { timeout: 75_000 },
  use: {
    baseURL: normalizeSmokeBaseUrl(process.env.SMOKE_BASE_URL),
    trace: 'on-first-retry',
  },
})
