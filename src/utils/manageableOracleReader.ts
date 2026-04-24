import { getAddress, ZeroAddress, type Provider } from 'ethers'
import erc20Artifact from '@/abis/ERC20.json'
import manageableOracleArtifact from '@/abis/ManageableOracle.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall, type ReadMulticallCall } from '@/utils/readMulticall'

const manageableOracleAbi = loadAbi(manageableOracleArtifact)
const siloConfigAbi = loadAbi(siloConfigArtifact)
const erc20Abi = loadAbi(erc20Artifact)

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

export type SiloConfigEntry = {
  silo: string
  token: string
  solvencyOracle: string
  maxLtvOracle: string
  interestRateModel: string
  symbol: string | null
  /**
   * `SILO_ID()` on the parent SiloConfig (same for all silos in one market). `null` when the
   * multicall slot failed — UI then just omits the `#id` prefix.
   */
  siloId: number | null
}

/**
 * One-shot batched read of `SiloConfig.getConfig(silo)` for every silo + the token `symbol()` for
 * every distinct underlying asset — one multicall each. Giving the UI the full ConfigData up front
 * (not just `solvencyOracle`) lets future actions (collateral share token, LTV oracle, hook
 * receiver, ...) reuse the same cached shape without re-reading on-chain.
 *
 * `symbolOverrides` (keys are lower-cased *token* addresses, not silo addresses) lets callers
 * with pre-fetched asset symbols — currently the predefined-silos picker, which receives both
 * tokens + symbols straight from `/api/earn-silos` — skip the on-chain `ERC20.symbol()`
 * multicall entirely when every requested token is covered. Partial overrides fall back to the
 * chain for the missing ones. Token-keyed (not silo-keyed) because the REST source only exposes
 * the earn-side silo address but *does* give us both token addresses.
 */
export async function readSiloConfigEntries(
  provider: Provider,
  siloConfig: string,
  silos: readonly string[],
  symbolOverrides?: Record<string, string>
): Promise<SiloConfigEntry[]> {
  const target = getAddress(siloConfig)
  const normalizedSilos = silos.map((s) => getAddress(s))

  /**
   * Batch `getConfig(silo)` for every silo plus a single `SILO_ID()` on the parent config, all in
   * one multicall. The extra id slot is cheap and avoids a second round-trip for a value the
   * market UI prefixes everywhere (e.g. `#3006 · Silo0 · USDC`).
   */
  type ConfigRow = {
    token: string | null
    solvencyOracle: string | null
    maxLtvOracle: string | null
    interestRateModel: string | null
  } | null
  const configCalls = normalizedSilos.map((silo) =>
    buildReadMulticallCall<ConfigRow>({
      target,
      abi: siloConfigAbi,
      functionName: 'getConfig',
      args: [silo],
      allowFailure: true,
      fallback: async () => null,
      decodeResult: (value) => {
        const cfg = value as Record<string, unknown>
        const token = typeof cfg?.token === 'string' ? getAddress(cfg.token) : null
        const solvencyOracle =
          typeof cfg?.solvencyOracle === 'string' ? getAddress(cfg.solvencyOracle) : null
        const maxLtvOracle =
          typeof cfg?.maxLtvOracle === 'string' ? getAddress(cfg.maxLtvOracle) : null
        const interestRateModel =
          typeof cfg?.interestRateModel === 'string' ? getAddress(cfg.interestRateModel) : null
        return { token, solvencyOracle, maxLtvOracle, interestRateModel }
      },
    })
  )
  const siloIdCall = buildReadMulticallCall<number | null>({
    target,
    abi: siloConfigAbi,
    functionName: 'SILO_ID',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => {
      if (value == null) return null
      try {
        const n = Number(value as bigint | number | string)
        return Number.isFinite(n) ? n : null
      } catch {
        return null
      }
    },
  })
  const rawResults = (await executeReadMulticall(
    provider,
    [...configCalls, siloIdCall] as unknown as ReadMulticallCall<unknown>[],
    { debugLabel: 'readSiloConfigEntries.getConfig' }
  )) as [...ConfigRow[], number | null]
  const configResults = rawResults.slice(0, normalizedSilos.length) as ConfigRow[]
  const siloId = rawResults[normalizedSilos.length] as number | null

  const partials = normalizedSilos.map((silo, i) => {
    const row = configResults[i] ?? null
    return {
      silo,
      token: row?.token ?? ZeroAddress,
      solvencyOracle: row?.solvencyOracle ?? ZeroAddress,
      maxLtvOracle: row?.maxLtvOracle ?? ZeroAddress,
      interestRateModel: row?.interestRateModel ?? ZeroAddress,
    }
  })

  /**
   * Fast path: if the caller supplied a symbol for every token we need, skip the ERC20 symbol
   * multicall entirely. Silos whose `getConfig` returned `ZeroAddress` as the token never had a
   * symbol to begin with and don't count as "missing".
   */
  const overrideByToken = new Map<string, string>()
  if (symbolOverrides) {
    for (const [key, sym] of Object.entries(symbolOverrides)) {
      if (sym) overrideByToken.set(key.toLowerCase(), sym)
    }
  }
  const needsOnChainSymbols = partials.some(
    (p) => p.token !== ZeroAddress && !overrideByToken.has(p.token.toLowerCase())
  )

  /**
   * Deduplicate tokens before calling `symbol()` — both silos in a market never share an asset
   * today, but the reader is cheap and stays correct if that ever changes. Only tokens without
   * an override are fetched, so partial overrides still save a slot.
   */
  const uniqueTokens = needsOnChainSymbols
    ? Array.from(
        new Set(
          partials
            .map((p) => p.token)
            .filter((t) => t !== ZeroAddress && !overrideByToken.has(t.toLowerCase()))
        )
      )
    : []
  const symbolResults = uniqueTokens.length
    ? await executeReadMulticall(
        provider,
        uniqueTokens.map((token) =>
          buildReadMulticallCall<string | null>({
            target: token,
            abi: erc20Abi,
            functionName: 'symbol',
            allowFailure: true,
            fallback: async () => null,
            decodeResult: (value) => (typeof value === 'string' ? value : null),
          })
        ),
        { debugLabel: 'readSiloConfigEntries.symbol' }
      )
    : []
  const symbolByToken = new Map<string, string | null>()
  uniqueTokens.forEach((token, i) => {
    symbolByToken.set(token.toLowerCase(), symbolResults[i] ?? null)
  })

  return partials.map((p) => {
    const tokenLc = p.token.toLowerCase()
    const override = overrideByToken.get(tokenLc) ?? null
    const onChain = p.token === ZeroAddress ? null : (symbolByToken.get(tokenLc) ?? null)
    return {
      ...p,
      symbol: override ?? onChain,
      siloId,
    }
  })
}
