import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'
import { normalizeSmokeBaseUrl } from '../../src/utils/smokeBaseUrl'

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
    inputVal = await vaultInput.inputValue()
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

test('vault page (VOLTS deep link) loads and no uncaught runtime errors', async ({ page }, testInfo) => {
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
  console.log(`[smoke] normalized base: ${base || '<empty>'}`)
  console.log(`[smoke] SMOKE_PAGE_PATH: ${path}`)

  const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
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

  // Let the browser run a paint + microtasks so client-only render errors (e.g. intentional /vault crash)
  // reach `page.on('pageerror')` before we start asserting on DOM.
  await page.waitForTimeout(150)
  const earlyPe = issues.filter((m) => m.startsWith('pageerror'))
  if (earlyPe.length > 0) {
    await attachScreenshot(testInfo, page, 'failure-pageerror-early.png')
    throw new Error(
      `[smoke] uncaught page error(s) right after navigation:\n${earlyPe.join('\n')}\nURL: ${page.url()}`
    )
  }

  const deadline = Date.now() + 75_000
  let iteration = 0
  let lastLog = 0

  while (Date.now() < deadline) {
    iteration += 1
    const st = await readVaultUiState(page, issues)

    if (st.pageErrors.length > 0) {
      await attachScreenshot(testInfo, page, 'failure-pageerror.png')
      throw new Error(
        `[smoke] uncaught page error(s):\n${st.pageErrors.join('\n')}\nURL: ${page.url()}`
      )
    }

    if (st.headingVisible && st.addressInInput) {
      console.log(`[smoke] vault UI ready after ${iteration} iteration(s)`)
      break
    }

    const now = Date.now()
    if (now - lastLog > 10_000) {
      lastLog = now
      console.log(
        `[smoke] still waiting (${Math.round((deadline - now) / 1000)}s left): ` +
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

  expect(issues, issues.join('\n')).toEqual([])
})
