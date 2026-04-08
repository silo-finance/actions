import { NETWORK_CONFIGS } from '@/utils/networks'

export type VaultInputKind =
  | { kind: 'address_only' }
  | { kind: 'explorer'; chainId: number }
  | { kind: 'unknown_url' }

function normalizeBaseHref(base: string): string {
  return base.replace(/\/$/, '')
}

/**
 * True if `user` is the explorer base or a path under it (query/hash allowed).
 */
function urlMatchesExplorerBase(user: URL, explorerBaseUrl: string): boolean {
  const base = normalizeBaseHref(explorerBaseUrl)
  const href = user.href.split(/[?#]/)[0].replace(/\/$/, '')
  return href === base || href.startsWith(`${base}/`)
}

function tryParseHttpUrl(raw: string): URL | null {
  const t = raw.trim()
  if (!t) return null
  let s = t
  if (!/^https?:\/\//i.test(s)) {
    if (/^www\./i.test(s)) s = `https://${s}`
    else return null
  }
  try {
    return new URL(s)
  } catch {
    return null
  }
}

/**
 * If the input is an HTTP(S) explorer URL we recognize, returns that chain.
 * Plain addresses or non-HTTP text → `address_only`.
 * HTTP(S) but no known explorer → `unknown_url`.
 */
export function classifyVaultInput(raw: string): VaultInputKind {
  const url = tryParseHttpUrl(raw)
  if (!url) return { kind: 'address_only' }

  for (const cfg of NETWORK_CONFIGS) {
    if (urlMatchesExplorerBase(url, cfg.explorerBaseUrl)) {
      return { kind: 'explorer', chainId: cfg.chainId }
    }
  }

  return { kind: 'unknown_url' }
}
