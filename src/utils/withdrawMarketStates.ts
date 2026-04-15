import { Contract, type Provider, getAddress } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

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

  return Promise.all(
    marketAddresses.map(async (raw) => {
      const addr = getAddress(raw)
      const m = new Contract(addr, erc4626Read, provider)
      const [shares, cfg, pending] = await Promise.all([
        m.balanceOf(vaultNorm),
        vault.config(addr),
        vault.pendingCap(addr),
      ])
      const supplyAssets = BigInt(String(await m.previewRedeem(shares)))
      const cap = BigInt(cfg.cap)
      const enabled = Boolean(cfg.enabled)
      const pendingCapValue = BigInt(pending.value)
      const pendingCapValidAt = BigInt(pending.validAt)
      const removableAt = BigInt(cfg.removableAt)
      return {
        address: addr,
        supplyShares: BigInt(String(shares)),
        supplyAssets,
        cap,
        enabled,
        pendingCapValue,
        pendingCapValidAt,
        removableAt,
      }
    })
  )
}
