import { Contract, JsonRpcProvider, type InterfaceAbi, type Provider, formatUnits } from 'ethers'
import SiloAbi from '@/abis/Silo.json'
import SiloLensAbi from '@/abis/ISiloLens.json'
import { executeReadMulticall, buildReadMulticallCall } from '@/utils/readMulticall'
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

function getReadonlyProvider(chainId: number): Provider {
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

export type LiquidationMarketDynamicState = {
  siloAddress: string
  totalAssetsStorage: bigint
  totalAssets: bigint
  interest: bigint
  liquidity: bigint
  totalDebt: bigint
}

export async function fetchMarketsDynamicState(
  chainId: number,
  entries: LiquidationSnapshotEntry[]
): Promise<Map<string, LiquidationMarketDynamicState>> {
  const provider = getReadonlyProvider(chainId)
  const states = new Map<string, LiquidationMarketDynamicState>()
  if (entries.length === 0) return states

  const calls = entries.flatMap((entry) => {
    const marketAddress = entry.siloAddress
    const direct = new Contract(marketAddress, SiloAbi, provider)
    return [
      buildReadMulticallCall({
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
      buildReadMulticallCall({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'totalAssets',
        fallback: async () => (await direct.totalAssets()) as bigint,
        decodeResult: (decoded) => decoded as bigint,
      }),
      buildReadMulticallCall({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'getLiquidity',
        fallback: async () => (await direct.getLiquidity()) as bigint,
        decodeResult: (decoded) => decoded as bigint,
      }),
      buildReadMulticallCall({
        target: marketAddress,
        abi: SiloAbi,
        functionName: 'getDebtAssets',
        fallback: async () => (await direct.getDebtAssets()) as bigint,
        decodeResult: (decoded) => decoded as bigint,
      }),
    ]
  })

  const results = await executeReadMulticall(provider, calls, {
    chainId,
    chunkSize: 128,
    debugLabel: `liq:${chainId}`,
  })

  for (let i = 0; i < entries.length; i += 1) {
    const baseIndex = i * 4
    const totalAssetsStorage = (results[baseIndex] as bigint | null) ?? BIGINT_ZERO
    const totalAssets = (results[baseIndex + 1] as bigint | null) ?? BIGINT_ZERO
    const liquidity = (results[baseIndex + 2] as bigint | null) ?? BIGINT_ZERO
    const totalDebt = (results[baseIndex + 3] as bigint | null) ?? BIGINT_ZERO
    const interest = totalAssets > totalAssetsStorage ? totalAssets - totalAssetsStorage : BIGINT_ZERO
    const siloAddress = entries[i]!.siloAddress.toLowerCase()
    states.set(siloAddress, {
      siloAddress,
      totalAssetsStorage,
      totalAssets,
      interest,
      liquidity,
      totalDebt,
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
  borrowers: string[]
): Promise<Map<string, boolean>> {
  const provider = getReadonlyProvider(chainId)
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
    out.set(normalizedBorrowers[i]!, Boolean(results[i]))
  }
  return out
}

export async function fetchBorrowersLtvFromSiloLens(
  chainId: number,
  siloAddress: string,
  borrowers: string[]
): Promise<Map<string, string>> {
  const provider = getReadonlyProvider(chainId)
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
