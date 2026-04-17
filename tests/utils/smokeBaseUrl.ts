export function normalizeSmokeBaseUrl(raw: string | undefined | null): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined

  try {
    const parsed = new URL(value)
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/`
    return parsed.toString()
  } catch {
    return `${value.replace(/\/+$/, '')}/`
  }
}

/**
 * Turn a repo-relative smoke path (e.g. `./vault/?chain=1&...`) into an absolute URL
 * using the GitHub Pages base. Playwright does not reliably resolve `./...` against `use.baseURL`.
 */
export function resolveSmokeTargetUrl(
  baseRaw: string | undefined | null,
  pagePath: string
): string {
  const base = normalizeSmokeBaseUrl(baseRaw)
  if (!base) {
    throw new Error(
      'SMOKE_BASE_URL is required for smoke tests. Example: SMOKE_BASE_URL=https://org.github.io/repo npm run test:smoke'
    )
  }
  const rel = pagePath.trim().replace(/^\.\//, '')
  return new URL(rel, base).toString()
}
