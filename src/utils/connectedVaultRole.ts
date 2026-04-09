import { Contract, type Provider, getAddress } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import type { OwnerKind } from '@/utils/ownerKind'
import { isAddressSafeOwner } from '@/utils/safeOwnerList'
import { loadAbi } from '@/utils/loadAbi'
import { classifyAllocatorVaultAction } from '@/utils/vaultActionAuthority'

const siloVaultAbi = loadAbi(siloVaultArtifact)

/**
 * SiloVault `setSupplyQueue` uses `onlyAllocatorRole`: `msg.sender` must be `owner()`, `curator`,
 * or have the allocator flag (`isAllocator[sender]`). It is not restricted to `onlyOwner`.
 * @see SiloVault `onlyAllocatorRole` modifier (e.g. silo-finance SiloVault.sol).
 */
export const SET_SUPPLY_QUEUE_ROLES_DESCRIPTION = 'the vault owner, curator, or allocator.'

function normAddr(a: string): string {
  return getAddress(a)
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
  ownerKind: OwnerKind,
  curatorKind: OwnerKind,
  guardianKind: OwnerKind
): Promise<string> {
  try {
    const c = normAddr(accountAddress)
    const own = normAddr(overview.owner)
    const cur = normAddr(overview.curator)
    const gua = normAddr(overview.guardian)
    const isAlloc = await fetchIsAllocatorForAccount(provider, vaultAddress, accountAddress)

    const isOwnerAddr = c === own
    const isCuratorAddr = c === cur
    const isGuardianAddr = c === gua

    let ownerSigner = false
    let curatorSigner = false
    let guardianSigner = false
    if (ownerKind === 'safe' && !isOwnerAddr) {
      try {
        ownerSigner = await isAddressSafeOwner(provider, overview.owner, accountAddress)
      } catch {
        ownerSigner = false
      }
    }
    if (curatorKind === 'safe' && !isCuratorAddr) {
      try {
        curatorSigner = await isAddressSafeOwner(provider, overview.curator, accountAddress)
      } catch {
        curatorSigner = false
      }
    }
    if (guardianKind === 'safe' && !isGuardianAddr) {
      try {
        guardianSigner = await isAddressSafeOwner(provider, overview.guardian, accountAddress)
      } catch {
        guardianSigner = false
      }
    }

    const labels: string[] = []
    if (isOwnerAddr) labels.push('owner')
    else if (ownerSigner) labels.push('owner')

    if (isCuratorAddr) labels.push('curator')
    else if (curatorSigner) labels.push('curator')

    if (isGuardianAddr) labels.push('guardian')
    else if (guardianSigner) labels.push('guardian')

    if (isAlloc) labels.push('allocator')

    return labels.length > 0 ? labels.join(', ') : 'none'
  } catch {
    return '—'
  }
}

/**
 * Whether the connected account can call `setSupplyQueue` on the vault (as owner, curator, or
 * allocator), including when acting for an owner or curator that is a contract wallet.
 */
export async function canConnectedAccountCallSetSupplyQueue(
  provider: Provider,
  vaultAddress: string,
  accountAddress: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind,
  curatorKind: OwnerKind
): Promise<boolean> {
  const a = await classifyAllocatorVaultAction(
    provider,
    vaultAddress,
    accountAddress,
    overview,
    ownerKind,
    curatorKind
  )
  return a.mode !== 'denied'
}

export type SetSupplyQueueExecutionMode = 'direct' | 'safe_propose' | 'denied'

/**
 * How this app should submit `setSupplyQueue`: direct RPC from the connected wallet, or a proposal as owner/curator.
 */
export async function classifySetSupplyQueueExecution(
  provider: Provider,
  vaultAddress: string,
  connectedAccount: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind,
  curatorKind: OwnerKind
): Promise<SetSupplyQueueExecutionMode> {
  const a = await classifyAllocatorVaultAction(
    provider,
    vaultAddress,
    connectedAccount,
    overview,
    ownerKind,
    curatorKind
  )
  if (a.mode === 'denied') return 'denied'
  if (a.mode === 'direct') return 'direct'
  return 'safe_propose'
}
