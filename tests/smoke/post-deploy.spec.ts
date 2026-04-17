import { expect, test } from '@playwright/test'
import { normalizeSmokeBaseUrl } from '../../src/utils/smokeBaseUrl'

/** Default: mainnet VOLTS vault deep link (matches deploy workflow smoke URL). */
const DEFAULT_SMOKE_PAGE_PATH =
  './vault/?chain=1&address=0x5362D5086FDef73450145492a66F8EBF210c5B9C'

function smokePagePath(): string {
  const raw = process.env.SMOKE_PAGE_PATH?.trim()
  return raw && raw.length > 0 ? raw : DEFAULT_SMOKE_PAGE_PATH
}

test('vault page (VOLTS deep link) loads and no uncaught runtime errors', async ({ page }) => {
  const issues: string[] = []

  page.on('pageerror', (err) => {
    issues.push(`pageerror: ${err.message}`)
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      issues.push(`console: ${msg.text()}`)
    }
  })

  const path = smokePagePath()
  const base = normalizeSmokeBaseUrl(process.env.SMOKE_BASE_URL) ?? ''
  console.log(`[smoke] SMOKE_BASE_URL (raw): ${process.env.SMOKE_BASE_URL ?? '<unset>'}`)
  console.log(`[smoke] normalized base (forced trailing slash): ${base || '<empty>'}`)
  console.log(`[smoke] SMOKE_PAGE_PATH: ${path}`)

  // With baseURL like https://org.github.io/repo, goto('/') drops the repo segment; keep paths relative to base.
  const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const loadedUrl = page.url()
  const status = response?.status() ?? null
  console.log(`[smoke] loaded URL: ${loadedUrl}`)
  console.log(`[smoke] initial navigation HTTP status: ${status ?? '<no-response>'}`)

  // Fail fast on non-200 HTTP response before running UI/runtime assertions.
  if (status !== 200) {
    const statusText = response?.statusText() ?? '<unknown>'
    throw new Error(
      `[smoke] expected HTTP 200 for "${loadedUrl}", got ${status ?? '<no-response>'} ${statusText}`
    )
  }

  const vaultHeading = page.getByRole('heading', { name: 'Vault' })
  const vaultInput = page.locator('#vault-input')

  await expect
    .poll(
      async () => {
        const pageErrors = issues.filter((m) => m.startsWith('pageerror'))
        if (pageErrors.length > 0) {
          throw new Error(pageErrors.join('\n'))
        }
        const headingOk = await vaultHeading.isVisible()
        let inputVal = ''
        try {
          inputVal = await vaultInput.inputValue()
        } catch {
          inputVal = ''
        }
        const inputOk = /5362d5086fdef73450145492a66f8ebf210c5b9c/i.test(inputVal)
        return headingOk && inputOk
      },
      {
        timeout: 75_000,
        intervals: [100, 250, 500],
        message:
          'Vault page did not show "Vault" + prefilled address from URL, or a client page error occurred',
      },
    )
    .toBe(true)

  expect(issues, issues.join('\n')).toEqual([])
})
