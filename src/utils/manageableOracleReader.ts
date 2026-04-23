import { getAddress, ZeroAddress, type Provider } from 'ethers'
import manageableOracleArtifact from '@/abis/ManageableOracle.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall, type ReadMulticallCall } from '@/utils/readMulticall'

const manageableOracleAbi = loadAbi(manageableOracleArtifact)
const siloConfigAbi = loadAbi(siloConfigArtifact)

export type ManageableOracleState = {
  oracleAddress: string
  versionString: string | null
  contractName: string | null
  version: string | null
  isManageable: boolean
  currentOracle: string | null
  pendingOracle: { value: string; validAt: number } | null
  owner: string | null
}

export type SiloSolvencyOracle = {
  silo: string
  solvencyOracle: string
}

/**
 * `VERSION()` on our oracle suite returns `"<ContractName> <semver>"` (e.g. `"ManageableOracle 1.0.0"`
 * or `"RevertingOracle 1.0.0"`). Split on the FIRST space so contract names with spaces never appear
 * (they don't today) but the version segment remains intact even when it contains dashes / pre-release
 * tags.
 */
export function parseManageableVersion(versionString: string | null): {
  contractName: string | null
  version: string | null
} {
  if (!versionString || typeof versionString !== 'string') {
    return { contractName: null, version: null }
  }
  const trimmed = versionString.trim()
  const idx = trimmed.indexOf(' ')
  if (idx < 0) {
    return { contractName: trimmed, version: null }
  }
  return { contractName: trimmed.slice(0, idx), version: trimmed.slice(idx + 1).trim() || null }
}

/**
 * Reads every field we need to present the oracle card + owner panel + pending panel for a single
 * oracle address via one multicall. `allowFailure=true` on every call so non-Manageable oracles
 * (e.g. DIA, Chronicle, Uniswap) return `isManageable: false` rather than throwing.
 */
export async function readManageableOracleState(
  provider: Provider,
  oracleAddress: string
): Promise<ManageableOracleState> {
  const target = getAddress(oracleAddress)

  const versionCall = buildReadMulticallCall<string | null>({
    target,
    abi: manageableOracleAbi,
    functionName: 'VERSION',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'string' ? value : null),
  })
  const oracleCall = buildReadMulticallCall<string | null>({
    target,
    abi: manageableOracleAbi,
    functionName: 'oracle',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'string' ? getAddress(value) : null),
  })
  const pendingCall = buildReadMulticallCall<{ value: string; validAt: number } | null>({
    target,
    abi: manageableOracleAbi,
    functionName: 'pendingOracle',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => {
      const tuple = value as unknown as { value?: unknown; validAt?: unknown } & [unknown, unknown]
      const rawValue = tuple?.value ?? tuple?.[0]
      const rawValidAt = tuple?.validAt ?? tuple?.[1]
      if (typeof rawValue !== 'string') return null
      const validAtNum = Number(rawValidAt ?? 0)
      return { value: getAddress(rawValue), validAt: Number.isFinite(validAtNum) ? validAtNum : 0 }
    },
  })
  const ownerCall = buildReadMulticallCall<string | null>({
    target,
    abi: manageableOracleAbi,
    functionName: 'owner',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'string' ? getAddress(value) : null),
  })

  /**
   * `executeReadMulticall` is generic in a single `T`, so we smuggle a mixed-shape tuple through
   * `ReadMulticallCall<unknown>` and narrow each slot by index after the batch resolves.
   */
  const results = (await executeReadMulticall(
    provider,
    [versionCall, oracleCall, pendingCall, ownerCall] as unknown as ReadMulticallCall<unknown>[],
    { debugLabel: 'readManageableOracleState' }
  )) as [
    string | null,
    string | null,
    { value: string; validAt: number } | null,
    string | null,
  ]
  const [versionString, currentOracle, pendingOracleRaw, owner] = results

  const parsed = parseManageableVersion(versionString)
  const isManageable = parsed.contractName === 'ManageableOracle'
  const pendingOracle =
    pendingOracleRaw && pendingOracleRaw.value !== ZeroAddress && pendingOracleRaw.validAt > 0
      ? pendingOracleRaw
      : null

  return {
    oracleAddress: target,
    versionString,
    contractName: parsed.contractName,
    version: parsed.version,
    isManageable,
    currentOracle,
    pendingOracle,
    owner,
  }
}

/**
 * Reads `solvencyOracle` from `SiloConfig.getConfig(silo)` for each supplied silo in a single
 * multicall. Silos where `getConfig` fails resolve to `solvencyOracle = ZeroAddress` and the caller
 * surfaces that as "no solvency oracle configured" — which should never happen in a healthy
 * deployment, but we never throw here so the UI can render something meaningful.
 */
export async function readSolvencyOraclesForSilos(
  provider: Provider,
  siloConfig: string,
  silos: readonly string[]
): Promise<SiloSolvencyOracle[]> {
  const target = getAddress(siloConfig)
  const normalizedSilos = silos.map((s) => getAddress(s))

  const results = await executeReadMulticall(
    provider,
    normalizedSilos.map((silo) =>
      buildReadMulticallCall<string | null>({
        target,
        abi: siloConfigAbi,
        functionName: 'getConfig',
        args: [silo],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => {
          const cfg = value as Record<string, unknown>
          const oracle = cfg?.solvencyOracle
          return typeof oracle === 'string' ? getAddress(oracle) : null
        },
      })
    ),
    { debugLabel: 'readSolvencyOraclesForSilos' }
  )

  return normalizedSilos.map((silo, i) => ({
    silo,
    solvencyOracle: typeof results[i] === 'string' ? (results[i] as string) : ZeroAddress,
  }))
}
