import { Contract, getAddress, type Provider } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { isAddressSafeOwner } from '@/utils/safeOwnerList'

const siloVaultAbi = loadAbi(siloVaultArtifact)

async function vaultIsAllocator(provider: Provider, vaultAddress: string, accountAddress: string): Promise<boolean> {
  const vault = new Contract(getAddress(vaultAddress), siloVaultAbi, provider)
  return Boolean(await vault.isAllocator(accountAddress))
}

export type VaultExecutionMode = 'direct' | 'safe_propose' | 'denied'

/** How the connected wallet may perform vault actions that require `onlyAllocatorRole`. */
export type VaultActionAuthority = {
  mode: VaultExecutionMode
  /** Safe that will be `msg.sender` on the vault when using the Safe Transaction Service. */
  executingSafeAddress: string | null
}

function n(a: string): string {
  return getAddress(a)
}

/**
 * `onlyAllocatorRole`: `msg.sender` is `owner()`, `curator`, or `isAllocator[sender]` (SiloVault).
 * When the vault owner or curator address is a Safe, a Safe owner can propose txs executed as that role.
 */
export async function classifyAllocatorVaultAction(
  provider: Provider,
  vaultAddress: string,
  connectedAccount: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind,
  curatorKind: OwnerKind
): Promise<VaultActionAuthority> {
  const c = n(connectedAccount)
  const owner = n(overview.owner)
  const curator = n(overview.curator)

  /** When the vault role is a Safe, never use `direct` with `connected ===` that role: WC / smart wallets may report the Safe as the connected account. */
  if (ownerKind === 'safe' && c === owner) {
    return { mode: 'safe_propose', executingSafeAddress: owner }
  }
  if (curatorKind === 'safe' && c === curator) {
    return { mode: 'safe_propose', executingSafeAddress: curator }
  }

  if (c === owner || c === curator) {
    return { mode: 'direct', executingSafeAddress: null }
  }

  if (await vaultIsAllocator(provider, vaultAddress, connectedAccount)) {
    return { mode: 'direct', executingSafeAddress: null }
  }

  if (ownerKind === 'safe' && (await isAddressSafeOwner(provider, overview.owner, connectedAccount))) {
    return { mode: 'safe_propose', executingSafeAddress: owner }
  }

  if (curatorKind === 'safe' && (await isAddressSafeOwner(provider, overview.curator, connectedAccount))) {
    return { mode: 'safe_propose', executingSafeAddress: curator }
  }

  return { mode: 'denied', executingSafeAddress: null }
}

/**
 * Batches that include `submitCap` need `onlyCuratorRole` for those calls: `msg.sender` must be
 * `owner()` or `curator` (SiloVault). Intersection with allocator-only paths is **owner or curator**
 * (directly or via the owner/curator contract wallet).
 */
export async function classifyOwnerOrCuratorVaultAction(
  provider: Provider,
  connectedAccount: string,
  overview: { owner: string; curator: string },
  ownerKind: OwnerKind,
  curatorKind: OwnerKind
): Promise<VaultActionAuthority> {
  const c = n(connectedAccount)
  const owner = n(overview.owner)
  const curator = n(overview.curator)

  if (ownerKind === 'safe' && c === owner) {
    return { mode: 'safe_propose', executingSafeAddress: owner }
  }
  if (curatorKind === 'safe' && c === curator) {
    return { mode: 'safe_propose', executingSafeAddress: curator }
  }

  if (c === owner || c === curator) {
    return { mode: 'direct', executingSafeAddress: null }
  }

  if (ownerKind === 'safe' && (await isAddressSafeOwner(provider, overview.owner, connectedAccount))) {
    return { mode: 'safe_propose', executingSafeAddress: owner }
  }

  if (curatorKind === 'safe' && (await isAddressSafeOwner(provider, overview.curator, connectedAccount))) {
    return { mode: 'safe_propose', executingSafeAddress: curator }
  }

  return { mode: 'denied', executingSafeAddress: null }
}

export const CLEAR_SUPPLY_QUEUE_DENIED_MESSAGE =
  'You cannot clear the supply queue. Connect with a wallet that has the owner, curator, or allocator role for this vault.'

export const WITHDRAW_REMOVAL_DENIED_MESSAGE =
  'You cannot run this flow with the connected wallet. If the flow lowers a cap, you need the owner or curator role; otherwise you need the owner, curator, or allocator role.'
