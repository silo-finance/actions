import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import { normalizeSmokeBaseUrl, resolveSmokeTargetUrl } from '../utils/smokeBaseUrl'

/** Default: mainnet VOLTS vault deep link (matches deploy workflow smoke URL). */
const DEFAULT_SMOKE_PAGE_PATH =
  './vault/?chain=1&address=0x5362D5086FDef73450145492a66F8EBF210c5B9C'

const VAULT_ADDR_RE = /5362d5086fdef73450145492a66f8ebf210c5b9c/i

function smokePagePath(): string {
  const raw = process.env.SMOKE_PAGE_PATH?.trim()
  return raw && raw.length > 0 ? raw : DEFAULT_SMOKE_PAGE_PATH
}

async function attachScreenshot(testInfo: TestInfo, page: Page, name: string) {
  const buf = await page.screenshot({ fullPage: true }).catch(() => null)
  if (buf) {
    await testInfo.attach(name, { body: buf, contentType: 'image/png' })
  }
}

async function readVaultUiState(page: Page, issues: string[]) {
  const vaultHeading = page.getByRole('heading', { name: 'Vault' })
  const vaultInput = page.locator('#vault-input')
  const headingVisible = await vaultHeading.isVisible().catch(() => false)
  let inputVal = ''
  try {
    // Do not block polling loop for long auto-waits when the input is missing/crashed.
    inputVal = await vaultInput.inputValue({ timeout: 200 })
  } catch {
    inputVal = ''
  }
  const pageErrors = issues.filter((m) => m.startsWith('pageerror'))
  const consoleErrors = issues.filter((m) => m.startsWith('console:'))
  return {
    headingVisible,
    inputLength: inputVal.length,
    inputPreview: inputVal.slice(0, 120),
    addressInInput: VAULT_ADDR_RE.test(inputVal),
    pageErrors,
    consoleErrors,
  }
}

async function failIfIssuesDetected(
  page: Page,
  testInfo: TestInfo,
  issues: string[],
  stage: string
) {
  const pageErrors = Array.from(new Set(issues.filter((m) => m.startsWith('pageerror'))))
  if (pageErrors.length > 0) {
    await attachScreenshot(testInfo, page, `failure-pageerror-${stage}.png`)
    throw new Error(
      `[smoke] uncaught page error(s) [${stage}] (unique=${pageErrors.length}):\n` +
        `${pageErrors.join('\n')}\n` +
        `URL: ${page.url()}`
    )
  }
  const consoleErrors = Array.from(new Set(issues.filter((m) => m.startsWith('console:'))))
  if (consoleErrors.length > 0) {
    await attachScreenshot(testInfo, page, `failure-console-error-${stage}.png`)
    throw new Error(
      `[smoke] console.error detected [${stage}] (unique=${consoleErrors.length}):\n` +
        `${consoleErrors.join('\n')}\n` +
        `URL: ${page.url()}`
    )
  }
}

async function failIfAppRuntimeErrorPageVisible(page: Page, testInfo: TestInfo, stage: string) {
  const marker = page.getByTestId('app-runtime-error')
  const markerVisible = await marker.isVisible().catch(() => false)
  if (!markerVisible) return

  const snippet = await page
    .evaluate(() => document.body?.innerText?.slice(0, 2000) ?? '')
    .catch(() => '<no body text>')
  await attachScreenshot(testInfo, page, `failure-app-runtime-error-page-${stage}.png`)
  throw new Error(
    `[smoke] custom app runtime error page detected [${stage}] (APP-500).\n` +
      `URL: ${page.url()}\n` +
      `Body snippet:\n${snippet}`
  )
}

test('vault page (VOLTS deep link) loads and no uncaught runtime errors', async ({ page }, testInfo) => {
  test.setTimeout(150_000)

  const path = smokePagePath()
  const baseRaw = process.env.SMOKE_BASE_URL
  const baseNormalized = normalizeSmokeBaseUrl(baseRaw)

  console.log('[smoke] ===== smoke test inputs (debug) =====')
  console.log(`[smoke] SMOKE_BASE_URL (raw from env): ${JSON.stringify(baseRaw ?? null)}`)
  console.log(
    `[smoke] SMOKE_BASE_URL (normalized): ${baseNormalized ?? '<empty — will fail on resolve>'}`
  )
  console.log(`[smoke] SMOKE_PAGE_PATH (raw from env): ${JSON.stringify(process.env.SMOKE_PAGE_PATH ?? null)}`)
  console.log(`[smoke] SMOKE_PAGE_PATH (effective for test): ${path}`)
  console.log('[smoke] ======================================')

  const issues: string[] = []

  page.on('pageerror', (err) => {
    issues.push(`pageerror: ${err.message}`)
  })

  page.on('crash', () => {
    issues.push('pageerror: Browser tab crashed')
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const loc = msg.location()
      const where = loc.url ? ` @ ${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : ''
      issues.push(`console: ${msg.text()}${where}`)
    }
  })

  const targetUrl = resolveSmokeTargetUrl(baseRaw, path)
  console.log(`[smoke] resolved navigation URL: ${targetUrl}`)

  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const loadedUrl = page.url()
  const status = response?.status() ?? null
  console.log(`[smoke] loaded URL: ${loadedUrl}`)
  console.log(`[smoke] initial navigation HTTP status: ${status ?? '<no-response>'}`)

  if (status !== 200) {
    const statusText = response?.statusText() ?? '<unknown>'
    throw new Error(
      `[smoke] expected HTTP 200 for "${loadedUrl}", got ${status ?? '<no-response>'} ${statusText}`
    )
  }

  // Let the browser run a paint + microtasks so client-only render errors reach `page.on('pageerror')` before we assert on DOM.
  await page.waitForTimeout(150)
  await failIfAppRuntimeErrorPageVisible(page, testInfo, 'early')
  await failIfIssuesDetected(page, testInfo, issues, 'early')

  const deadline = Date.now() + 75_000
  let iteration = 0
  // Must not start at 0: `Date.now() - 0` would fire a fake "still waiting" on the first poll (~250ms).
  let lastHeartbeatLog = Date.now()

  console.log(
    '[smoke] polling until Vault heading + deep-linked address in #vault-input (transient empty input is ok during hydration)'
  )

  while (Date.now() < deadline) {
    iteration += 1

    // Fail fast before any DOM polling that could auto-wait.
    await failIfIssuesDetected(page, testInfo, issues, 'poll')
    await failIfAppRuntimeErrorPageVisible(page, testInfo, 'poll')

    const st = await readVaultUiState(page, issues)

    if (st.headingVisible && st.addressInInput) {
      console.log(`[smoke] vault UI ready after ${iteration} iteration(s)`)
      break
    }

    const now = Date.now()
    if (now - lastHeartbeatLog >= 10_000) {
      lastHeartbeatLog = now
      console.log(
        `[smoke] heartbeat — poll window ~${Math.round((deadline - now) / 1000)}s left: ` +
          `headingVisible=${st.headingVisible}, inputLen=${st.inputLength}, ` +
          `addressInInput=${st.addressInInput}, inputPreview=${JSON.stringify(st.inputPreview)}, ` +
          `consoleErrors=${st.consoleErrors.length}` +
          (st.consoleErrors.length ? `, last=${JSON.stringify(st.consoleErrors.at(-1))}` : '')
      )
    }

    await page.waitForTimeout(250)
  }

  const final = await readVaultUiState(page, issues)
  if (!final.headingVisible || !final.addressInInput) {
    await attachScreenshot(testInfo, page, 'failure-timeout.png')
    const snippet = await page
      .evaluate(() => document.body?.innerText?.slice(0, 2000) ?? '')
      .catch(() => '<no body text>')
    console.log(`[smoke] body text snippet (first 2000 chars):\n${snippet}`)
    throw new Error(
      `[smoke] timeout: vault UI not ready after 75s.\n` +
        `headingVisible=${final.headingVisible}\n` +
        `inputLen=${final.inputLength}\n` +
        `inputPreview=${JSON.stringify(final.inputPreview)}\n` +
        `pageErrors=${JSON.stringify(final.pageErrors)}\n` +
        `consoleErrors=${JSON.stringify(final.consoleErrors)}\n` +
        `URL=${page.url()}`
    )
  }

  // Keep the page alive for a short stabilization window to catch late async React/runtime crashes.
  await page.waitForTimeout(1_500)
  await failIfAppRuntimeErrorPageVisible(page, testInfo, 'stabilization')
  await failIfIssuesDetected(page, testInfo, issues, 'stabilization')

  expect(issues, issues.join('\n')).toEqual([])
})
