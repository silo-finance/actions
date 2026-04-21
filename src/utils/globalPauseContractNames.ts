import { getAddress } from 'ethers'

/**
 * There is no addr→name index in the Silo deployments repo; the only way to label addresses
 * from `allContracts()` is to walk the per-chain deployment directory and match each
 * `*.sol.json` artifact by its `address` field. We front-load filenames mentioning `leverage`
 * or `router` because those are the common members of the global pause registry.
 */
const GITHUB_CONTENTS_BASE =
  'https://api.github.com/repos/silo-finance/silo-contracts-v3/contents/silo-core/deployments'

const DEFAULT_CONCURRENCY = 4

type ContentsEntry = {
  name: string
  path: string
  type: string
  download_url: string | null
}

export type FetchGlobalPauseContractNamesOptions = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Parallel artifact reads. Defaults to 4 — enough to be fast, low enough not to burn rate-limit. */
  concurrency?: number
  /** Test hook so callers can assert order. Not used in production. */
  onDebug?: (event: { phase: 'priority' | 'rest'; artifact: string; matched: boolean }) => void
}

const inMemoryCache = new Map<string, Map<string, string>>()

function cacheKey(chainName: string, addresses: string[]): string {
  const normalized = addresses
    .map((a) => {
      try {
        return getAddress(a).toLowerCase()
      } catch {
        return a.toLowerCase()
      }
    })
    .sort()
  return `${chainName}::${normalized.join(',')}`
}

function humanizeArtifactFilename(name: string): string {
  /** Strip `.sol.json`, also handle unusual `.json` fallback so we never return the raw filename. */
  let base = name
  if (base.endsWith('.sol.json')) base = base.slice(0, -'.sol.json'.length)
  else if (base.endsWith('.json')) base = base.slice(0, -'.json'.length)
  return base
}

function isPriorityArtifact(filename: string): boolean {
  const lower = filename.toLowerCase()
  return lower.includes('leverage') || lower.includes('router')
}

function normalizePendingSet(addresses: string[]): Set<string> {
  const out = new Set<string>()
  for (const a of addresses) {
    try {
      out.add(getAddress(a).toLowerCase())
    } catch {
      out.add(a.toLowerCase())
    }
  }
  return out
}

function extractArtifactAddress(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const candidate = (body as { address?: unknown }).address
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  try {
    return getAddress(trimmed).toLowerCase()
  } catch {
    return null
  }
}

async function listDeploymentArtifacts(
  chainName: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<ContentsEntry[]> {
  const url = `${GITHUB_CONTENTS_BASE}/${chainName}`
  const res = await fetchImpl(url, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) {
    throw new Error(`Could not list Silo deployments for ${chainName} (HTTP ${res.status}).`)
  }
  const body = (await res.json()) as unknown
  if (!Array.isArray(body)) return []
  return (body as ContentsEntry[]).filter(
    (e) => e && e.type === 'file' && typeof e.name === 'string' && e.name.endsWith('.sol.json')
  )
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  if (items.length === 0) return
  const queue = items.slice()
  const tasks: Promise<void>[] = []
  for (let i = 0; i < Math.max(1, concurrency); i += 1) {
    tasks.push(
      (async () => {
        while (queue.length > 0 && !shouldStop()) {
          const next = queue.shift()
          if (next === undefined) return
          await worker(next)
        }
      })()
    )
  }
  await Promise.all(tasks)
}

/**
 * Resolves friendly names for addresses returned by `GlobalPause.allContracts()`.
 *
 * Strategy:
 *   1. GitHub Contents API call lists every `*.sol.json` artifact for the chain.
 *   2. Artifacts whose filename contains `leverage` / `router` are checked first (cheap heuristic
 *      based on what the pause registry usually holds).
 *   3. Remaining artifacts are iterated only if any address is still unresolved.
 *   4. Module-level cache avoids re-walking the repo on re-renders within the same session.
 *
 * Unresolved addresses are simply absent from the returned map — the UI falls back to the raw
 * address for them.
 */
export async function fetchGlobalPauseContractNames(
  chainName: string,
  addresses: string[],
  opts: FetchGlobalPauseContractNamesOptions = {}
): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map()
  const key = cacheKey(chainName, addresses)
  const cached = inMemoryCache.get(key)
  if (cached) return cached

  const fetchImpl = opts.fetchImpl ?? fetch
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  const signal = opts.signal

  const entries = await listDeploymentArtifacts(chainName, fetchImpl, signal)
  const pending = normalizePendingSet(addresses)
  const resolved = new Map<string, string>()

  const priority: ContentsEntry[] = []
  const rest: ContentsEntry[] = []
  for (const entry of entries) {
    if (isPriorityArtifact(entry.name)) priority.push(entry)
    else rest.push(entry)
  }

  const processArtifact = async (entry: ContentsEntry, phase: 'priority' | 'rest') => {
    if (pending.size === 0) return
    if (!entry.download_url) return
    let res: Response
    try {
      res = await fetchImpl(entry.download_url, { signal })
    } catch {
      return
    }
    if (!res.ok) return
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return
    }
    const addr = extractArtifactAddress(body)
    if (!addr) {
      opts.onDebug?.({ phase, artifact: entry.name, matched: false })
      return
    }
    if (pending.has(addr)) {
      pending.delete(addr)
      resolved.set(addr, humanizeArtifactFilename(entry.name))
      opts.onDebug?.({ phase, artifact: entry.name, matched: true })
    } else {
      opts.onDebug?.({ phase, artifact: entry.name, matched: false })
    }
  }

  await runWithConcurrency(priority, concurrency, (e) => processArtifact(e, 'priority'), () => pending.size === 0)
  if (pending.size > 0) {
    await runWithConcurrency(rest, concurrency, (e) => processArtifact(e, 'rest'), () => pending.size === 0)
  }

  inMemoryCache.set(key, resolved)
  return resolved
}

/** Test-only helper: reset the in-memory cache between runs. */
export function _resetGlobalPauseContractNamesCache(): void {
  inMemoryCache.clear()
}
