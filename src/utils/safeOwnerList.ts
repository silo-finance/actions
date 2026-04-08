import { Contract, getAddress, type Provider } from 'ethers'

const GET_OWNERS_ABI = ['function getOwners() view returns (address[])'] as const

/** Returns true if `account` is one of the Safe `getOwners()` entries (checksummed compare). */
export async function isAddressSafeOwner(
  provider: Provider,
  safeAddress: string,
  account: string
): Promise<boolean> {
  const safe = new Contract(getAddress(safeAddress), GET_OWNERS_ABI, provider)
  const owners: string[] = await safe.getOwners()
  let acc: string
  try {
    acc = getAddress(account)
  } catch {
    return false
  }
  return owners.some((o) => {
    try {
      return getAddress(String(o)) === acc
    } catch {
      return false
    }
  })
}
