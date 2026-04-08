import { Contract, type Provider, getAddress } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

const siloVaultAbi = loadAbi(siloVaultArtifact)

const erc4626Read = [
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
] as const

export type WithdrawMarketOnchainState = {
  address: string
  supplyAssets: bigint
  cap: bigint
  enabled: boolean
  pendingCapValidAt: bigint
  /** Non-zero while a forced removal timelock is pending (`submitMarketRemoval`). */
  removableAt: bigint
}

/**
 * Per-withdraw-queue market: vault ERC-4626 position and SiloVault config.
 */
export async function fetchWithdrawMarketStates(
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
      const supplyAssets = BigInt(await m.convertToAssets(shares))
      const cap = BigInt(cfg.cap)
      const enabled = Boolean(cfg.enabled)
      const pendingCapValidAt = BigInt(pending.validAt)
      const removableAt = BigInt(cfg.removableAt)
      return { address: addr, supplyAssets, cap, enabled, pendingCapValidAt, removableAt }
    })
  )
}
