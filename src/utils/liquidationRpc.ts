import { Contract, JsonRpcProvider, type Provider, formatUnits } from 'ethers'
import SiloAbi from '@/abis/Silo.json'
import { executeReadMulticall, buildReadMulticallCall } from '@/utils/readMulticall'
import { NETWORK_CONFIGS } from '@/utils/networks'
import type { LiquidationSnapshotEntry } from '@/utils/liquidationSnapshot'

const providerCache = new Map<number, Provider>()
const BIGINT_ZERO = BigInt(0)

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

export function formatAssetAmount(value: bigint, decimals: number | null): string {
  const d = decimals ?? 18
  const asNum = Number(formatUnits(value, d))
  if (!Number.isFinite(asNum)) return '—'
  if (Math.abs(asNum) >= 1_000_000) return asNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (Math.abs(asNum) >= 1_000) return asNum.toLocaleString(undefined, { maximumFractionDigits: 3 })
  if (Math.abs(asNum) >= 1) return asNum.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return asNum.toLocaleString(undefined, { maximumFractionDigits: 8 })
}
