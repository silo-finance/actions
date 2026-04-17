import { expect, test } from '@playwright/test'

test('home page loads and no uncaught runtime errors', async ({ page }) => {
  const issues: string[] = []

  page.on('pageerror', (err) => {
    issues.push(`pageerror: ${err.message}`)
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      issues.push(`console: ${msg.text()}`)
    }
  })

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Control Panel' })).toBeVisible({ timeout: 60_000 })

  expect(issues, issues.join('\n')).toEqual([])
})
