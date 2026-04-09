import { Contract, type Provider, getAddress } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import type { OwnerKind } from '@/utils/ownerKind'
import { isAddressSafeOwner } from '@/utils/safeOwnerList'
import { loadAbi } from '@/utils/loadAbi'

const siloVaultAbi = loadAbi(siloVaultArtifact)

/**
 * SiloVault `setSupplyQueue` uses `onlyAllocatorRole`: `msg.sender` must be `owner()`, `curator`,
 * or have the allocator flag (`isAllocator[sender]`). It is not restricted to `onlyOwner`.
 * @see SiloVault `onlyAllocatorRole` modifier (e.g. silo-finance SiloVault.sol).
 */
export const SET_SUPPLY_QUEUE_ROLES_DESCRIPTION =
  'the vault owner, curator, or an allocator. If the vault owner is a Gnosis Safe, a listed Safe owner can propose that call through the Safe.'

function normAddr(a: string): string {
  return getAddress(a)
}

/**
 * SiloVault role labels for the connected wallet. Owner short-circuits; otherwise
 * curator, guardian, and allocator (flag) are combined when they match.
 */
export function describeConnectedVaultRole(input: {
  connected: string
  owner: string
  curator: string
  guardian: string
  isAllocator: boolean
}): string {
  const c = normAddr(input.connected)
  if (c === normAddr(input.owner)) return 'Owner'

  const parts: string[] = []
  if (c === normAddr(input.curator)) parts.push('Curator')
  if (c === normAddr(input.guardian)) parts.push('Guardian')
  if (input.isAllocator) parts.push('Allocator')

  return parts.length > 0 ? parts.join(', ') : 'None'
}

export async function fetchIsAllocatorForAccount(
  provider: Provider,
  vaultAddress: string,
  accountAddress: string
): Promise<boolean> {
  const vault = new Contract(normAddr(vaultAddress), siloVaultAbi, provider)
  return Boolean(await vault.isAllocator(accountAddress))
}

export async function fetchConnectedVaultRoleLabel(
  provider: Provider,
  vaultAddress: string,
  accountAddress: string,
  overview: { owner: string; curator: string; guardian: string },
  ownerKind: OwnerKind
): Promise<string> {
  try {
    if (normAddr(accountAddress) === normAddr(overview.owner)) return 'Owner'
  } catch {
    return '—'
  }
  const isAlloc = await fetchIsAllocatorForAccount(provider, vaultAddress, accountAddress)
  const label = describeConnectedVaultRole({
    connected: accountAddress,
    owner: overview.owner,
    curator: overview.curator,
    guardian: overview.guardian,
    isAllocator: isAlloc,
  })
  if (label !== 'None') return label

  if (ownerKind === 'safe') {
    try {
      const isSigner = await isAddressSafeOwner(provider, overview.owner, accountAddress)
      if (isSigner) return 'Signer'
    } catch {
      // fall through to None
    }
  }

  return 'None'
}

/**
 * Whether `msg.sender == connectedAccount` can call `setSupplyQueue` on the vault, or (when the
 * vault owner is a Safe) the wallet can propose the vault call via the Transaction Service.
 */
export async function canConnectedAccountCallSetSupplyQueue(
  provider: Provider,
  vaultAddress: string,
  accountAddress: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind
): Promise<boolean> {
  const mode = await classifySetSupplyQueueExecution(provider, vaultAddress, accountAddress, overview, ownerKind)
  return mode !== 'denied'
}

export type SetSupplyQueueExecutionMode = 'direct' | 'safe_propose' | 'denied'

/**
 * How this app should submit `setSupplyQueue`: direct RPC from the connected wallet, or Safe tx proposal.
 */
export async function classifySetSupplyQueueExecution(
  provider: Provider,
  vaultAddress: string,
  connectedAccount: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind
): Promise<SetSupplyQueueExecutionMode> {
  try {
    const c = normAddr(connectedAccount)
    const owner = normAddr(overview.owner)
    const curator = normAddr(overview.curator)
    const isAlloc = await fetchIsAllocatorForAccount(provider, vaultAddress, connectedAccount)

    if (c === curator || isAlloc) return 'direct'
    if (ownerKind === 'eoa' && c === owner) return 'direct'

    if (ownerKind === 'safe') {
      const isSigner = await isAddressSafeOwner(provider, overview.owner, connectedAccount)
      if (isSigner) return 'safe_propose'
    }

    return 'denied'
  } catch {
    return 'denied'
  }
}
