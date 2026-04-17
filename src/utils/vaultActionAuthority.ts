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

export type VaultExecutionMode = 'direct' | 'safe_as_wallet' | 'safe_propose' | 'denied'

/** How the connected wallet may perform vault actions that require `onlyAllocatorRole`. */
export type VaultActionAuthority = {
  mode: VaultExecutionMode
  /**
   * Safe that will be `msg.sender` on the vault.
   * - `safe_propose`: Safe the connected EOA is an owner of; target for the Safe Transaction Service proposal.
   * - `safe_as_wallet`: Safe that IS the connected wallet (WalletConnect from Safe{Wallet} or Safe Apps iframe).
   */
  executingSafeAddress: string | null
}

function n(a: string): string {
  return getAddress(a)
}

/**
 * `onlyAllocatorRole`: `msg.sender` is `owner()`, `curator`, or `isAllocator[sender]` (SiloVault).
 *
 * Routing:
 * - `connectedAccount === Safe role` (WC from Safe{Wallet} / Safe Apps iframe / Rabby impersonate):
 *   → `safe_as_wallet`. Send `eth_sendTransaction` via the Safe wallet — it builds the proposal
 *   internally. Do NOT `personal_sign(safeTxHash)` here: Safe{Wallet} would create a Safe Message
 *   (not a tx) and Rabby would try to collect EIP-1271 owner signatures.
 * - Connected EOA is a Safe owner → `safe_propose`: sign the Safe tx hash off-chain and push to
 *   the Safe Transaction Service as a pending proposal.
 * - Connected EOA equals the role (and role is EOA) or is allocator → `direct`.
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

  if (ownerKind === 'safe' && c === owner) {
    return { mode: 'safe_as_wallet', executingSafeAddress: owner }
  }
  if (curatorKind === 'safe' && c === curator) {
    return { mode: 'safe_as_wallet', executingSafeAddress: curator }
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
 * (directly or via the owner/curator contract wallet). Same `safe_as_wallet` / `safe_propose`
 * routing as {@link classifyAllocatorVaultAction}.
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
    return { mode: 'safe_as_wallet', executingSafeAddress: owner }
  }
  if (curatorKind === 'safe' && c === curator) {
    return { mode: 'safe_as_wallet', executingSafeAddress: curator }
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
