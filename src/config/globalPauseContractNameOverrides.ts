/**
 * Manual override map for contract names surfaced in the Global Pause section.
 *
 * Precedence: overrides here ALWAYS win over the programmatic Silo-deployments walker
 * (`fetchGlobalPauseContractNames`). Use this file when:
 *   - a contract is missing from the Silo deployments repo (e.g. external integrator contract),
 *   - the artifact filename is ambiguous and we want a friendlier display name,
 *   - we want to pin a name without paying the GitHub Contents API fetch.
 *
 * The pause-capable Silo deployments below were seeded from
 * `silo-contracts-v3/silo-core/deployments` via
 * `node ./scripts/print-global-pause-name-overrides.mjs`. Re-run that helper to refresh
 * the snapshot when new deployments land. Hand-curated entries (e.g. external multisigs,
 * legacy router addresses) are preserved across refreshes — the script only prints,
 * it never rewrites this file.
 */
type ChainOverrides = Record<string, string>

export const GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES: Record<number, ChainOverrides> = {
  // Ethereum Mainnet
  1: {
    '0x50dAac2ffcf6276c76E7Ad4162E2d7F75dDA22b1': 'LeverageRouter',
    '0x024b641f3582F5842714A8fD25D62BE536560A6f': 'SiloRouterV2',
    '0x931e59f06b83dD3d9A622FD4537989B6C63B9bde': 'LeverageRouter',
    '0x57073028155901314E860666A4b3A88B8df88167': 'LeverageUsingSiloFlashloanWithGeneralSwap',
    '0x9Ea2867DBb81DDd45D28276F513622988fE21A10': 'SiloRouterV2',
  },
  // Optimism
  10: {
    '0x539AC1fa1EeB2986Bb772e965502B2d5913d53A4': 'SiloRouterV2',
    '0x319f7155cC65F693E84689535aFb1343C704C0B8': 'SiloRouterV2',
  },
  // XDC Network
  50: {
    '0xe3aE3f11D2aFD7031D3C92774166571b057E8A87': 'LeverageRouter',
    '0x4fFf70C17fb974121a1Ad64C97b04a2e38DbfE7C': 'SiloRouterV2',
  },
  // BNB Chain
  56: {
    '0x4A6c34A6B8F5C1a1Dcdc4be664cbC1259a0737a6': 'LeverageRouter',
    '0x5EA25a8E52729a81FA53c91cF56051b495265C46': 'SiloRouterV2',
  },
  // Sonic
  146: {
    '0x451b35b2dF223a7Ef71c4ecb451C1C15019e28A5': 'LeverageRouter',
    '0x9Fa3C1E843d8eb1387827E5d77c07E8BB97B1e50': 'SiloRouterV2',
    '0x2A3ba33389CEDAF9bbC8B00F5F9e8732D805e3E2': 'LeverageRouter',
    '0x503628e0799bA076dF56Da7c0a51FE1426358d8C': 'LeverageUsingSiloFlashloanWithGeneralSwap',
    '0x16876aF41E8beDdBF9B67D2B66Bb50Abf3503B1C': 'SiloRouterV2',
  },
  // OKX
  196: {
    '0x4A6c34A6B8F5C1a1Dcdc4be664cbC1259a0737a6': 'LeverageRouter',
    '0x5EA25a8E52729a81FA53c91cF56051b495265C46': 'SiloRouterV2',
  },
  // Injective
  1776: {
    '0x205451eB57b1C302EC58443223B52AadD13d69B9': 'LeverageRouter',
    '0xAd84B07082c67a1105b933c28f8c8bA5b89DFcFA': 'SiloRouterV2',
  },
  // Arbitrum One
  42161: {
    '0x128b7b7457e35E201Da5024C9e8D024e1b0AF94b': 'LeverageRouter',
    '0xd039005e47fC31605192B6BCC1A4803A3abDf623': 'SiloRouterV2',
    '0x1FD32c02b7fe914a607880Fe64F591407443020d': 'hypernative wallet',
    '0x9e6bD1d23339E2719422478cEF4EE4457904301b': 'LeverageRouter',
    '0xEb5a0eF2Cdd79c61c7a0FCc08e618c238d5aA335': 'SiloRouterV2',
  },
  // Avalanche C-Chain
  43114: {
    '0x4576fa3e2E061376431619B5631C25c99fFa27bd': 'SiloRouterV2',
    '0x9Ac6932592Dd721f34Ee9c1Bf36e763DDfb08629': 'LeverageRouter',
    '0x2AeC24E2fac282134C28c419CD44b021412C1Fd1': 'LeverageRouter',
    '0x39F7eed73d48760e19e8408B29dA6b3372EEE1Cf': 'SiloRouterV2',
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
