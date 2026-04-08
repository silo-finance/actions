import { Contract, type Provider } from 'ethers'

const SAFE_MIN_ABI = [
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
] as const

export type OwnerKind = 'eoa' | 'safe' | 'contract'

/**
 * EOA if no bytecode. For contracts: Safe if getThreshold > 0 and getOwners().length > 0 (both calls succeed).
 */
export async function analyzeOwnerKind(provider: Provider, ownerAddress: string): Promise<OwnerKind> {
  const code = await provider.getCode(ownerAddress)
  const hex = code.replace(/^0x/i, '')
  if (hex.length === 0) return 'eoa'

  try {
    const safe = new Contract(ownerAddress, SAFE_MIN_ABI, provider)
    const [threshold, owners] = await Promise.all([safe.getThreshold(), safe.getOwners()])
    const t = BigInt(threshold)
    const len = Array.isArray(owners) ? owners.length : 0
    if (t > BigInt(0) && len > 0) return 'safe'
  } catch {
    // not Safe-compatible
  }
  return 'contract'
}
