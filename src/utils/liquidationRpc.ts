import { Contract, JsonRpcProvider, type InterfaceAbi, type Provider, formatUnits } from 'ethers'
import SiloAbi from '@/abis/Silo.json'
import SiloLensAbi from '@/abis/ISiloLens.json'
import { executeReadMulticall, buildReadMulticallCall, type ReadMulticallCall } from '@/utils/readMulticall'
import { NETWORK_CONFIGS } from '@/utils/networks'
import type { LiquidationSnapshotEntry } from '@/utils/liquidationSnapshot'

const providerCache = new Map<number, Provider>()
const missingLensWarningChains = new Set<number>()
const missingLensFallbackWarningChains = new Set<number>()
const siloLensAddressPromiseCache = new Map<number, Promise<string | null>>()
const BIGINT_ZERO = BigInt(0)
const SiloLensInterfaceAbi = (SiloLensAbi as { abi?: InterfaceAbi }).abi ?? []
const SILO_LENS_DEPLOYMENTS_BASE_URL =
  'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/develop/silo-core/deployments'
const FLASHLOAN_SOURCES_URL =
  'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/refs/heads/master/common/externalFlashloan/flashloanSources.json'
const externalFlashloanSourcesPromiseCache = new Map<number, Promise<Map<string, string[]>>>()

type ExternalFlashloanSourcesPayload = Record<string, Record<string, string[]>>

function resolveExternalFlashloanChainKeys(chainName: string): string[] {
  const normalized = chainName.trim().toLowerCase()
  if (!normalized) return []
  const variants = new Set<string>([normalized, normalized.replace(/_/g, '-')])
  if (normalized === 'arbitrum_one') variants.add('arbitrum-one')
  return Array.from(variants)
}

function getRpcOverrideUrl(chainId: number): string | null {
  const envByChain: Record<number, Array<string | undefined>> = {
    1: [process.env.RPC_URL_ETHEREUM, process.env.NEXT_PUBLIC_RPC_ETHEREUM],
    50: [process.env.RPC_URL_XDC, process.env.NEXT_PUBLIC_RPC_XDC],
    146: [process.env.RPC_URL_SONIC, process.env.NEXT_PUBLIC_RPC_SONIC],
    1776: [process.env.RPC_URL_INJECTIVE, process.env.NEXT_PUBLIC_RPC_INJECTIVE],
    42161: [process.env.RPC_URL_ARBITRUM, process.env.NEXT_PUBLIC_RPC_ARBITRUM],
    43114: [process.env.RPC_URL_AVALANCHE, process.env.NEXT_PUBLIC_RPC_AVALANCHE],
  }
  const candidates = envByChain[chainId] ?? []
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value) return value
  }
  return null
}

function getSiloLensOverrideAddress(chainId: number): string | null {
  const envByChain: Record<number, Array<string | undefined>> = {
    1: [process.env.SILO_LENS_ETHEREUM, process.env.NEXT_PUBLIC_SILO_LENS_ETHEREUM],
    50: [process.env.SILO_LENS_XDC, process.env.NEXT_PUBLIC_SILO_LENS_XDC],
    146: [process.env.SILO_LENS_SONIC, process.env.NEXT_PUBLIC_SILO_LENS_SONIC],
    1776: [process.env.SILO_LENS_INJECTIVE, process.env.NEXT_PUBLIC_SILO_LENS_INJECTIVE],
    42161: [process.env.SILO_LENS_ARBITRUM, process.env.NEXT_PUBLIC_SILO_LENS_ARBITRUM],
    43114: [process.env.SILO_LENS_AVALANCHE, process.env.NEXT_PUBLIC_SILO_LENS_AVALANCHE],
  }
  const candidates = envByChain[chainId] ?? []
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value) return value
  }
  return null
}

async function fetchSiloLensAddressFromDeploymentsRepo(chainId: number): Promise<string | null> {
  const network = NETWORK_CONFIGS.find((row) => row.chainId === chainId)
  const deploymentDir = network?.chainName?.trim()
  if (!deploymentDir) return null
  const url = `${SILO_LENS_DEPLOYMENTS_BASE_URL}/${deploymentDir}/SiloLens.sol.json`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as { address?: unknown }
    const address = typeof json.address === 'string' ? json.address.trim() : ''
    return address || null
  } catch {
    return null
  }
}

export function getSiloLensAddressForChain(chainId: number): Promise<string | null> {
  const cached = siloLensAddressPromiseCache.get(chainId)
  if (cached) return cached
  const promise = (async () => {
    const fromRepo = await fetchSiloLensAddressFromDeploymentsRepo(chainId)
    if (fromRepo) return fromRepo

    const fromEnvFallback = getSiloLensOverrideAddress(chainId)
    if (fromEnvFallback && !missingLensFallbackWarningChains.has(chainId)) {
      missingLensFallbackWarningChains.add(chainId)
      console.warn(`[liq-ltv:${chainId}] using env fallback Silo Lens address because deployments repo lookup failed`)
    }
    return fromEnvFallback
  })()
  siloLensAddressPromiseCache.set(chainId, promise)
  return promise
}

export function getReadonlyProvider(chainId: number): Provider {
  const cached = providerCache.get(chainId)
  if (cached) return cached
  const cfg = NETWORK_CONFIGS.find((row) => row.chainId === chainId)
  const overrideRpc = getRpcOverrideUrl(chainId)
  if (!cfg || cfg.walletRpcUrls.length === 0) {
    if (!overrideRpc) throw new Error(`Missing RPC URL for chain ${chainId}`)
  }
  const provider = new JsonRpcProvider(overrideRpc ?? cfg!.walletRpcUrls[0], chainId)
  providerCache.set(chainId, provider)
  return provider
}

type ReadProviderPolicyOptions = {
  preferredProvider?: Provider | null
  preferredChainId?: number | null
}

function selectReadProvider(chainId: number, options?: ReadProviderPolicyOptions): Provider {
  const preferredProvider = options?.preferredProvider ?? null
  const preferredChainId = options?.preferredChainId ?? null
  if (preferredProvider && preferredChainId === chainId) return preferredProvider
  return getReadonlyProvider(chainId)
}

export type LiquidationMarketDynamicState = {
  siloAddress: string
  totalAssetsStorage: bigint
  totalAssets: bigint
  interest: bigint
  liquidity: bigint
  totalDebt: bigint
  externalLiquidity: bigint
  hasExternalLiquiditySource: boolean
  externalLiquiditySources: Array<{
    sourceAddress: string
    amount: bigint
    version: string
  }>
}

/** Primary silo plus paired `otherSilo` addresses, deduped by lowercase key. */
function collectUniqueSiloAddresses(entries: LiquidationSnapshotEntry[]): string[] {
  const byLower = new Map<string, string>()
  for (const entry of entries) {
    byLower.set(entry.siloAddress.toLowerCase(), entry.siloAddress)
    const other = entry.otherSilo?.siloAddress
    if (other) byLower.set(other.toLowerCase(), other)
  }
  return Array.from(byLower.values())
}

function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim()
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed.toLowerCase() : null
}

function collectPrimaryTokenAddresses(entries: LiquidationSnapshotEntry[]): string[] {
  const out = new Map<string, string>()
  for (const entry of entries) {
    const normalized = entry.tokenAddress ? normalizeAddress(entry.tokenAddress) : null
    if (normalized) out.set(normalized, normalized)
  }
  return Array.from(out.values())
}

function buildTokenAddressBySilo(entries: LiquidationSnapshotEntry[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const entry of entries) {
    const siloAddress = normalizeAddress(entry.siloAddress)
    if (siloAddress) {
      out.set(siloAddress, entry.tokenAddress ? normalizeAddress(entry.tokenAddress) : null)
    }
    const otherSiloAddress = entry.otherSilo?.siloAddress ? normalizeAddress(entry.otherSilo.siloAddress) : null
    if (otherSiloAddress) {
      out.set(
        otherSiloAddress,
        entry.otherSilo?.tokenAddress ? normalizeAddress(entry.otherSilo.tokenAddress) : null
      )
    }
  }
  return out
}

async function fetchExternalFlashloanSourcesForChain(chainId: number): Promise<Map<string, string[]>> {
  const cached = externalFlashloanSourcesPromiseCache.get(chainId)
  if (cached) return cached
  const promise = (async () => {
    const chainName = NETWORK_CONFIGS.find((row) => row.chainId === chainId)?.chainName?.toLowerCase()
    if (!chainName) return new Map<string, string[]>()
    try {
      const response = await fetch(FLASHLOAN_SOURCES_URL)
      if (!response.ok) return new Map<string, string[]>()
      const payload = (await response.json()) as ExternalFlashloanSourcesPayload
      const chainKeys = resolveExternalFlashloanChainKeys(chainName)
      const rawByToken = chainKeys
        .map((key) => payload?.[key])
        .find((candidate) => candidate && typeof candidate === 'object')
      if (!rawByToken || typeof rawByToken !== 'object') return new Map<string, string[]>()
      const out = new Map<string, string[]>()
      for (const [rawTokenAddress, rawSources] of Object.entries(rawByToken)) {
        const tokenAddress = normalizeAddress(rawTokenAddress)
        if (!tokenAddress || !Array.isArray(rawSources)) continue
        const sources = rawSources
          .map((sourceAddress) => normalizeAddress(sourceAddress))
          .filter((sourceAddress): sourceAddress is string => sourceAddress != null)
        out.set(tokenAddress, sources)
      }
      return out
    } catch {
      return new Map<string, string[]>()
    }
  })()
  externalFlashloanSourcesPromiseCache.set(chainId, promise)
  return promise
}

export async function fetchMarketsDynamicState(
  chainId: number,
  entries: LiquidationSnapshotEntry[]
): Promise<Map<string, LiquidationMarketDynamicState>> {
  const provider = getReadonlyProvider(chainId)
  const states = new Map<string, LiquidationMarketDynamicState>()
  const siloAddresses = collectUniqueSiloAddresses(entries)
  const tokenAddressBySilo = buildTokenAddressBySilo(entries)
  const primaryTokenAddresses = collectPrimaryTokenAddresses(entries)
  const externalSourcesByToken = await fetchExternalFlashloanSourcesForChain(chainId)
  const lensAddress = await getSiloLensAddressForChain(chainId)
  const canUseLensVersionLookup = Boolean(
    lensAddress && Array.isArray(SiloLensInterfaceAbi) && SiloLensInterfaceAbi.length > 0
  )
  if (siloAddresses.length === 0) return states

  const marketCalls: ReadMulticallCall<bigint | string>[] = siloAddresses.flatMap((marketAddress) => {
    const direct = new Contract(marketAddress, SiloAbi, provider)
    return [
      // Collateral storage + protected storage (UI Total Assets); not ERC4626 totalAssets().
      buildReadMulticallCall<bigint | string>({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'getCollateralAndProtectedTotalsStorage',
        fallback: async () => {
          const [collateral, protectedAssets] = await direct.getCollateralAndProtectedTotalsStorage()
          return (collateral as bigint) + (protectedAssets as bigint)
        },
        decodeResult: (decoded) => {
          const tuple = decoded as [bigint, bigint]
          return tuple[0] + tuple[1]
        },
      }),
      buildReadMulticallCall<bigint | string>({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'getLiquidity',
        fallback: async () => (await direct.getLiquidity()) as bigint,
        decodeResult: (decoded) => decoded as bigint,
      }),
      buildReadMulticallCall<bigint | string>({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'getDebtAssets',
        fallback: async () => (await direct.getDebtAssets()) as bigint,
        decodeResult: (decoded) => decoded as bigint,
      }),
    ]
  })
  const externalCallDescriptors: Array<{
    tokenAddress: string
    sourceAddress: string
    amountCallOffset: number
    versionCallOffset: number
  }> = []
  const externalCalls: ReadMulticallCall<bigint | string>[] = []
  for (const tokenAddress of primaryTokenAddresses) {
    const sourceAddresses = externalSourcesByToken.get(tokenAddress) ?? []
    for (const sourceAddress of sourceAddresses) {
      const source = new Contract(sourceAddress, SiloAbi, provider)
      const lens = canUseLensVersionLookup ? new Contract(lensAddress!, SiloLensInterfaceAbi, provider) : null
      const amountCallOffset = externalCalls.length
      externalCalls.push(
        buildReadMulticallCall<bigint | string>({
          target: sourceAddress,
          abi: SiloAbi,
          functionName: 'maxFlashLoan',
          args: [tokenAddress],
          allowFailure: true,
          fallback: async () => {
            try {
              return (await source.maxFlashLoan(tokenAddress)) as bigint
            } catch {
              return BIGINT_ZERO
            }
          },
          decodeResult: (decoded) => decoded as bigint,
        })
      )
      const versionCallOffset = externalCalls.length
      externalCalls.push(
        canUseLensVersionLookup
          ? buildReadMulticallCall<bigint | string>({
              target: lensAddress!,
              abi: SiloLensInterfaceAbi,
              functionName: 'getVersion',
              args: [sourceAddress],
              allowFailure: true,
              fallback: async () => {
                try {
                  return lens ? ((await lens.getVersion(sourceAddress)) as string) : ''
                } catch {
                  return ''
                }
              },
              decodeResult: (decoded) => String(decoded ?? ''),
            })
          : buildReadMulticallCall<bigint | string>({
              target: sourceAddress,
              abi: SiloAbi,
              functionName: 'eip712Domain',
              allowFailure: true,
              fallback: async () => {
                try {
                  const domain = (await source.eip712Domain()) as { version?: unknown } | unknown[]
                  if (Array.isArray(domain)) return String(domain[2] ?? '')
                  return String(domain?.version ?? '')
                } catch {
                  return ''
                }
              },
              decodeResult: (decoded) => {
                const tuple = decoded as [unknown, unknown, unknown, unknown, unknown, unknown, unknown]
                return String(tuple[2] ?? '')
              },
            })
      )
      externalCallDescriptors.push({
        tokenAddress,
        sourceAddress,
        amountCallOffset,
        versionCallOffset,
      })
    }
  }
  const calls = [...marketCalls, ...externalCalls]

  const results = await executeReadMulticall(provider, calls, {
    chainId,
    chunkSize: 128,
    debugLabel: `liq:${chainId}`,
  })
  const externalLiquidityByToken = new Map<string, bigint>()
  const externalLiquiditySourcesByToken = new Map<
    string,
    Array<{
      sourceAddress: string
      amount: bigint
      version: string
    }>
  >()
  for (let descriptorIndex = 0; descriptorIndex < externalCallDescriptors.length; descriptorIndex += 1) {
    const descriptor = externalCallDescriptors[descriptorIndex]!
    const amount = (results[marketCalls.length + descriptor.amountCallOffset] as bigint | null) ?? BIGINT_ZERO
    const versionRaw = results[marketCalls.length + descriptor.versionCallOffset]
    const version = typeof versionRaw === 'string' && versionRaw.trim() ? versionRaw.trim() : '?'
    const current = externalLiquidityByToken.get(descriptor.tokenAddress) ?? BIGINT_ZERO
    externalLiquidityByToken.set(descriptor.tokenAddress, current + amount)
    const currentSources = externalLiquiditySourcesByToken.get(descriptor.tokenAddress) ?? []
    currentSources.push({
      sourceAddress: descriptor.sourceAddress,
      amount,
      version,
    })
    externalLiquiditySourcesByToken.set(descriptor.tokenAddress, currentSources)
  }

  for (let i = 0; i < siloAddresses.length; i += 1) {
    const baseIndex = i * 3
    const totalAssetsStorage = (results[baseIndex] as bigint | null) ?? BIGINT_ZERO
    const totalAssets = totalAssetsStorage
    const liquidity = (results[baseIndex + 1] as bigint | null) ?? BIGINT_ZERO
    const totalDebt = (results[baseIndex + 2] as bigint | null) ?? BIGINT_ZERO
    const siloAddress = siloAddresses[i]!.toLowerCase()
    const tokenAddress = tokenAddressBySilo.get(siloAddress) ?? null
    const hasExternalLiquiditySource = tokenAddress ? externalSourcesByToken.has(tokenAddress) : false
    const externalLiquidity = tokenAddress ? (externalLiquidityByToken.get(tokenAddress) ?? BIGINT_ZERO) : BIGINT_ZERO
    const externalLiquiditySources = tokenAddress ? (externalLiquiditySourcesByToken.get(tokenAddress) ?? []) : []
    states.set(siloAddress, {
      siloAddress,
      totalAssetsStorage,
      totalAssets,
      interest: BIGINT_ZERO,
      liquidity,
      totalDebt,
      externalLiquidity,
      hasExternalLiquiditySource,
      externalLiquiditySources,
    })
  }

  return states
}

function normalizeBorrowerAddress(raw: string): string | null {
  const trimmed = raw.trim()
  const directMatch = /^0x[0-9a-fA-F]{40}$/.exec(trimmed)
  if (directMatch) return trimmed.toLowerCase()
  const suffixMatch = /(0x[0-9a-fA-F]{40})$/.exec(trimmed)
  return suffixMatch ? suffixMatch[1].toLowerCase() : null
}

export async function fetchBorrowersSolvency(
  chainId: number,
  siloAddress: string,
  borrowers: string[],
  options?: ReadProviderPolicyOptions
): Promise<Map<string, boolean>> {
  const provider = selectReadProvider(chainId, options)
  const out = new Map<string, boolean>()
  const normalizedBorrowers = Array.from(new Set(borrowers.map((addr) => normalizeBorrowerAddress(addr)).filter(Boolean)))
  if (normalizedBorrowers.length === 0) return out

  const silo = new Contract(siloAddress, SiloAbi, provider)
  const calls = normalizedBorrowers.map((borrowerAddress) =>
    buildReadMulticallCall({
      target: siloAddress,
      abi: SiloAbi,
      functionName: 'isSolvent',
      args: [borrowerAddress],
      // Oracle/pricing reverts must not fail the whole market solvency batch.
      allowFailure: true,
      fallback: async () => (await silo.isSolvent(borrowerAddress)) as boolean,
      decodeResult: (decoded) => Boolean(decoded),
    })
  )

  const results = await executeReadMulticall(provider, calls, {
    chainId,
    chunkSize: 128,
    debugLabel: `liq-solvency:${chainId}`,
  })
  for (let i = 0; i < normalizedBorrowers.length; i += 1) {
    const value = results[i]
    if (value == null) continue
    out.set(normalizedBorrowers[i]!, Boolean(value))
  }
  return out
}

export async function fetchBorrowersLtvFromSiloLens(
  chainId: number,
  siloAddress: string,
  borrowers: string[],
  options?: ReadProviderPolicyOptions
): Promise<Map<string, string>> {
  const provider = selectReadProvider(chainId, options)
  const out = new Map<string, string>()
  const normalizedBorrowers = Array.from(new Set(borrowers.map((addr) => normalizeBorrowerAddress(addr)).filter(Boolean)))
  if (normalizedBorrowers.length === 0) return out

  const lensAddress = await getSiloLensAddressForChain(chainId)
  if (!lensAddress) {
    if (!missingLensWarningChains.has(chainId)) {
      missingLensWarningChains.add(chainId)
      console.warn(`[liq-ltv:${chainId}] missing Silo Lens address from deployments repo (and env fallback); skipping realtime LTV refresh`)
    }
    return out
  }
  if (!Array.isArray(SiloLensInterfaceAbi) || SiloLensInterfaceAbi.length === 0) {
    console.warn(`[liq-ltv:${chainId}] Silo Lens ABI is empty; skipping realtime LTV refresh`)
    return out
  }

  const lens = new Contract(lensAddress, SiloLensInterfaceAbi, provider)
  const calls = normalizedBorrowers.map((borrowerAddress) =>
    buildReadMulticallCall({
      target: lensAddress,
      abi: SiloLensInterfaceAbi,
      functionName: 'getUserLTV',
      args: [siloAddress, borrowerAddress],
      fallback: async () => ((await lens.getUserLTV(siloAddress, borrowerAddress)) as bigint).toString(),
      decodeResult: (decoded) => (decoded as bigint).toString(),
    })
  )

  const results = await executeReadMulticall(provider, calls, {
    chainId,
    chunkSize: 128,
    debugLabel: `liq-ltv:${chainId}`,
    logRpcCalls: true,
    rpcMethodName: 'getUserLTV',
  })
  for (let i = 0; i < normalizedBorrowers.length; i += 1) {
    const value = results[i]
    if (value == null) continue
    out.set(normalizedBorrowers[i]!, String(value))
  }
  return out
}

export function formatAssetAmount(value: bigint, decimals: number | null): string {
  const d = decimals ?? 18
  const asNum = Number(formatUnits(value, d))
  if (!Number.isFinite(asNum)) return '—'
  if (Math.abs(asNum) >= 1_000_000) return asNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(asNum) >= 1_000) return asNum.toLocaleString(undefined, { maximumFractionDigits: 3 })
  if (Math.abs(asNum) >= 1) return asNum.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return asNum.toLocaleString(undefined, { maximumFractionDigits: 8 })
}
