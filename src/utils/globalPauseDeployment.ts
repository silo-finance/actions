import { getAddress } from 'ethers'
import { getNetworkConfig } from '@/utils/networks'

/**
 * Source of truth for deployed `GlobalPause` addresses: Silo Finance public deployments repo.
 * We live-fetch the per-chain artifact every time the section loads; the artifact `.address`
 * field is extracted as the contract address. Keeps us in sync with Silo releases without
 * pinning addresses in this repo.
 */
const SILO_DEPLOYMENTS_RAW_BASE =
  'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/master/silo-core/deployments'

const GLOBAL_PAUSE_ARTIFACT_FILENAME = 'GlobalPause.sol.json'

export type GlobalPauseDeployment = {
  chainId: number
  chainName: string
  address: string
  sourceUrl: string
}

export function getGlobalPauseDeploymentUrl(chainName: string): string {
  return `${SILO_DEPLOYMENTS_RAW_BASE}/${chainName}/${GLOBAL_PAUSE_ARTIFACT_FILENAME}`
}

function extractAddressFromArtifact(artifact: unknown): string | null {
  if (!artifact || typeof artifact !== 'object') return null
  const candidate = (artifact as { address?: unknown }).address
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  try {
    return getAddress(trimmed)
  } catch {
    return null
  }
}

/** Public alias so tests and callers can parse an already-downloaded artifact body. */
export function parseGlobalPauseArtifact(artifact: unknown): string | null {
  return extractAddressFromArtifact(artifact)
}

export type FetchGlobalPauseAddressOptions = {
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function fetchGlobalPauseAddress(
  chainId: number,
  opts: FetchGlobalPauseAddressOptions = {}
): Promise<GlobalPauseDeployment> {
  const network = getNetworkConfig(chainId)
  if (!network) {
    throw new Error(`Chain ${chainId} is not supported.`)
  }
  const url = getGlobalPauseDeploymentUrl(network.chainName)
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(url, { signal: opts.signal, cache: 'no-store' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not reach Silo deployments for ${network.displayName}. ${msg}`)
  }
  if (res.status === 404) {
    throw new Error(
      `Silo deployments for ${network.displayName} do not publish a GlobalPause artifact yet.`
    )
  }
  if (!res.ok) {
    throw new Error(
      `Could not load GlobalPause artifact for ${network.displayName} (HTTP ${res.status}).`
    )
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error(`Could not parse GlobalPause artifact for ${network.displayName}.`)
  }
  const address = extractAddressFromArtifact(body)
  if (!address) {
    throw new Error(
      `GlobalPause artifact for ${network.displayName} has no valid \`address\` field.`
    )
  }
  return {
    chainId,
    chainName: network.chainName,
    address,
    sourceUrl: url,
  }
}
