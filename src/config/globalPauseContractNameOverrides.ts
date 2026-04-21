/**
 * Manual override map for contract names surfaced in the Global Pause section.
 *
 * Precedence: overrides here ALWAYS win over the programmatic Silo-deployments walker
 * (`fetchGlobalPauseContractNames`). Use this file when:
 *   - a contract is missing from the Silo deployments repo (e.g. external integrator contract),
 *   - the artifact filename is ambiguous and we want a friendlier display name,
 *   - we want to pin a name without paying the GitHub Contents API fetch.
 *
 * Each chain has at least one placeholder entry (`0x0000…0000` → `null`) so the schema is
 * visible. Add real entries below with lowercase-or-checksummed addresses — the lookup
 * normalizes to lowercase anyway.
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

type ChainOverrides = Record<string, string>

export const GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES: Record<number, ChainOverrides> = {
  // Ethereum Mainnet
  1: {
    "0x50dAac2ffcf6276c76E7Ad4162E2d7F75dDA22b1": 'LeverageRouter',
    "0x024b641f3582F5842714A8fD25D62BE536560A6f": 'SiloRouterV2',
  },
  // Optimism
  10: {
    "0x539AC1fa1EeB2986Bb772e965502B2d5913d53A4": 'SiloRouterV2',
  },
  // XDC Network
  50: {
    [ZERO_ADDRESS]: 'null',
  },
  // BNB Chain
  56: {
    [ZERO_ADDRESS]: 'null',
  },
  // Sonic
  146: {
    "0x451b35b2dF223a7Ef71c4ecb451C1C15019e28A5": 'LeverageRouter',
    "0x9Fa3C1E843d8eb1387827E5d77c07E8BB97B1e50": 'SiloRouterV2',
  },
  // OKX
  196: {
    [ZERO_ADDRESS]: 'null',
  },
  // Injective
  1776: {
    [ZERO_ADDRESS]: 'null',
  },
  // Arbitrum One
  42161: {
    "0x128b7b7457e35E201Da5024C9e8D024e1b0AF94b": 'LeverageRouter',
    "0xd039005e47fC31605192B6BCC1A4803A3abDf623": 'SiloRouterV2',
    "0x1FD32c02b7fe914a607880Fe64F591407443020d": 'hypernative wallet',
  },
  // Avalanche C-Chain
  43114: {
    "0x4576fa3e2E061376431619B5631C25c99fFa27bd": 'SiloRouterV2',
    "0x9Ac6932592Dd721f34Ee9c1Bf36e763DDfb08629": 'LeverageRouter',
  },
}

function normalize(address: string): string | null {
  if (typeof address !== 'string') return null
  /** Accept `0X` / `0x` prefixes and mixed case alike — manual map authors may paste any form. */
  const candidate = /^0X/.test(address) ? `0x${address.slice(2)}` : address
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) return null
  return candidate.toLowerCase()
}

/** Looks up a manual override for `address` on `chainId`. Returns `null` when not defined. */
export function getGlobalPauseContractNameOverride(chainId: number, address: string): string | null {
  const chainMap = GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES[chainId]
  if (!chainMap) return null
  const key = normalize(address)
  if (!key) return null
  /** Legacy-safe: map authors may paste checksummed strings; we normalize both sides to lowercase. */
  for (const rawKey of Object.keys(chainMap)) {
    if (rawKey.toLowerCase() === key) return chainMap[rawKey] ?? null
  }
  return null
}

/** Returns only the addresses from `addresses` that are NOT covered by the override map for `chainId`. */
export function filterAddressesWithoutOverride(chainId: number, addresses: string[]): string[] {
  return addresses.filter((a) => getGlobalPauseContractNameOverride(chainId, a) == null)
}
