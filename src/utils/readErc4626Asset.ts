import { Contract, getAddress, type Provider } from 'ethers'

const ASSET_ABI = ['function asset() view returns (address)'] as const

/** Returns underlying `asset()` for a standard ERC-4626-style vault, or `null` if the call fails. */
export async function readErc4626Asset(provider: Provider, contractAddress: string): Promise<string | null> {
  try {
    const norm = getAddress(contractAddress)
    const c = new Contract(norm, ASSET_ABI, provider)
    const a = await c.asset()
    return getAddress(String(a))
  } catch {
    return null
  }
}
