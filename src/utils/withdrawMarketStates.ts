import { Contract, type Provider, getAddress } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall } from '@/utils/readMulticall'

const siloVaultAbi = loadAbi(siloVaultArtifact)

const erc4626Read = [
  'function balanceOf(address account) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
] as const

export type WithdrawMarketOnchainState = {
  address: string
  /** Vault ERC-4626 shares on this market (`balanceOf(vault)`). */
  supplyShares: bigint
  /** `previewRedeem(supplyShares)` — withdraw-oriented principal in underlying; can be 0 while `supplyShares` &gt; 0 (dust). */
  supplyAssets: bigint
  cap: bigint
  enabled: boolean
  /** Pending cap value from `pendingCap(market).value` (not yet applied until `acceptCap`). */
  pendingCapValue: bigint
  pendingCapValidAt: bigint
  /** Non-zero while a forced removal timelock is pending (`submitMarketRemoval`). */
  removableAt: bigint
}

/**
 * Per market: vault ERC-4626 position and SiloVault `config` / `pendingCap` (same RPC shape for any queued market).
 */
export async function fetchVaultMarketStates(
  provider: Provider,
  vaultAddress: string,
  marketAddresses: string[]
): Promise<WithdrawMarketOnchainState[]> {
  const vaultNorm = getAddress(vaultAddress)
  const vault = new Contract(vaultNorm, siloVaultAbi, provider)
  const markets = marketAddresses.map((raw) => {
    const addr = getAddress(raw)
    return {
      address: addr,
      contract: new Contract(addr, erc4626Read, provider),
    }
  })

  const phase1Calls = markets.flatMap((market) => [
    buildReadMulticallCall({
      target: market.address,
      abi: erc4626Read,
      functionName: 'balanceOf',
      args: [vaultNorm],
      fallback: async () => market.contract.balanceOf(vaultNorm),
      decodeResult: (value) => BigInt(String(value)),
    }),
    buildReadMulticallCall({
      target: vaultNorm,
      abi: siloVaultAbi,
      functionName: 'config',
      args: [market.address],
      fallback: async () => vault.config(market.address),
    }),
    buildReadMulticallCall({
      target: vaultNorm,
      abi: siloVaultAbi,
      functionName: 'pendingCap',
      args: [market.address],
      fallback: async () => vault.pendingCap(market.address),
    }),
  ])

  const phase1Results = await executeReadMulticall(provider, phase1Calls, {
    debugLabel: 'withdrawMarketStates:phase1',
  })

  const sharesByMarket = new Map<string, bigint>()
  const cfgByMarket = new Map<string, { cap: unknown; enabled: unknown; removableAt: unknown }>()
  const pendingByMarket = new Map<string, { value: unknown; validAt: unknown }>()
  for (let i = 0; i < markets.length; i += 1) {
    const market = markets[i]!
    const r0 = phase1Results[i * 3]
    const r1 = phase1Results[i * 3 + 1]
    const r2 = phase1Results[i * 3 + 2]
    if (r0 == null || r1 == null || r2 == null) {
      throw new Error(`fetchVaultMarketStates: missing phase1 state for ${market.address}`)
    }
    sharesByMarket.set(market.address, r0 as bigint)
    cfgByMarket.set(market.address, r1 as { cap: unknown; enabled: unknown; removableAt: unknown })
    pendingByMarket.set(market.address, r2 as { value: unknown; validAt: unknown })
  }

  const phase2Calls = markets.map((market) => {
    const shares = sharesByMarket.get(market.address)
    if (shares == null) {
      throw new Error(`fetchVaultMarketStates: missing shares for ${market.address}`)
    }
    return buildReadMulticallCall({
      target: market.address,
      abi: erc4626Read,
      functionName: 'previewRedeem',
      args: [shares],
      fallback: async () => market.contract.previewRedeem(shares),
      decodeResult: (value) => BigInt(String(value)),
    })
  })

  const supplyAssetsResults = await executeReadMulticall(provider, phase2Calls, {
    debugLabel: 'withdrawMarketStates:phase2',
  })

  return markets.map((market, index) => {
    const cfg = cfgByMarket.get(market.address)
    const pending = pendingByMarket.get(market.address)
    const shares = sharesByMarket.get(market.address)
    const supplyAssets = supplyAssetsResults[index]
    if (cfg == null || pending == null || shares == null || supplyAssets == null) {
      throw new Error(`fetchVaultMarketStates: missing resolved state for ${market.address}`)
    }
    return {
      address: market.address,
      supplyShares: shares,
      supplyAssets: supplyAssets as bigint,
      cap: BigInt(String(cfg.cap)),
      enabled: Boolean(cfg.enabled),
      pendingCapValue: BigInt(String(pending.value)),
      pendingCapValidAt: BigInt(String(pending.validAt)),
      removableAt: BigInt(String(cfg.removableAt)),
    }
  })
}
