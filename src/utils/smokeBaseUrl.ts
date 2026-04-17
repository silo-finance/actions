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
