import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import { Interface, getAddress, MaxUint256, type Provider } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { isAddressSafeOwner } from '@/utils/safeOwnerList'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const vaultIface = new Interface(siloVaultAbi)

export type MarketAllocationTuple = { market: string; assets: bigint }

const SAFE_TX_ORIGIN = 'Silo Actions: withdraw-queue removal (reallocate / submitCap(0) / updateWithdrawQueue)'

const Z = BigInt(0)

/** Vault position headroom under cap: how much more can be supplied before hitting cap (not cap alone). */
export function vaultMarketSupplyHeadroom(supplyAssets: bigint, cap: bigint): bigint {
  return cap > supplyAssets ? cap - supplyAssets : Z
}

function supplyHeadroom(
  market: string,
  supplyAssetsByMarket: Map<string, bigint>,
  capByMarket: Map<string, bigint>
): bigint {
  const supply = supplyAssetsByMarket.get(market) ?? Z
  const cap = capByMarket.get(market) ?? Z
  return vaultMarketSupplyHeadroom(supply, cap)
}

/**
 * Destination markets sorted by supply headroom (largest first). SiloVault `reallocate` gives each
 * `type(uint256).max` step the full remaining withdrawal; the first step that can accept it must
 * fit the entire amount, so we put the deepest headroom first. Later `max` steps supply 0.
 */
export function sortDestinationsByHeadroomDesc(
  destinationMarkets: string[],
  supplyAssetsByMarket: Map<string, bigint>,
  capByMarket: Map<string, bigint>
): string[] {
  const dests = destinationMarkets.map((a) => getAddress(a))
  return [...dests].sort((a, b) => {
    const ha = supplyHeadroom(a, supplyAssetsByMarket, capByMarket)
    const hb = supplyHeadroom(b, supplyAssetsByMarket, capByMarket)
    if (ha < hb) return 1
    if (ha > hb) return -1
    return 0
  })
}

/**
 * Build `reallocate`: full withdraw from `source` (`assets == 0`), then `type(uint256).max` on every
 * destination (caps are not encoded — only used off-chain in {@link destinationsHaveEnoughHeadroom}).
 */
export function buildReallocateAllocations(params: {
  sourceMarket: string
  destinationMarkets: string[]
  supplyAssetsByMarket: Map<string, bigint>
  capByMarket: Map<string, bigint>
}): MarketAllocationTuple[] {
  const source = getAddress(params.sourceMarket)
  const dests = params.destinationMarkets.map((a) => getAddress(a))
  if (dests.length === 0) {
    throw new Error('Select at least one destination market.')
  }
  const seen = new Set<string>()
  for (const d of dests) {
    if (d === source) {
      throw new Error('Destination markets must not include the market being removed.')
    }
    if (seen.has(d)) throw new Error('Duplicate destination market.')
    seen.add(d)
  }

  const amountToMove = params.supplyAssetsByMarket.get(source) ?? Z
  if (amountToMove <= Z) {
    throw new Error('Nothing to move from the selected market (zero vault position).')
  }

  const sorted = sortDestinationsByHeadroomDesc(dests, params.supplyAssetsByMarket, params.capByMarket)
  const allocations: MarketAllocationTuple[] = [{ market: source, assets: Z }]
  for (const m of sorted) {
    allocations.push({ market: m, assets: MaxUint256 })
  }
  return allocations
}

/**
 * With `max` on every supply step, the first step receives the full withdrawn amount; it reverts if
 * that amount exceeds that market's headroom. So at least one selected market must fit the whole move.
 */
export function destinationsHaveEnoughHeadroom(params: {
  amountToMove: bigint
  destinationMarkets: string[]
  supplyAssetsByMarket: Map<string, bigint>
  capByMarket: Map<string, bigint>
}): boolean {
  if (params.amountToMove <= Z) return true
  const dests = params.destinationMarkets.map((a) => getAddress(a))
  if (dests.length === 0) return false
  let maxHeadroom = Z
  for (const m of dests) {
    const h = supplyHeadroom(m, params.supplyAssetsByMarket, params.capByMarket)
    if (h > maxHeadroom) maxHeadroom = h
  }
  return maxHeadroom >= params.amountToMove
}

/** Current supply queue with `removedMarket` removed once; order of remaining entries is preserved. */
export function supplyQueueAfterRemovingMarket(supplyQueue: string[], removedMarket: string): string[] {
  const r = getAddress(removedMarket)
  const out: string[] = []
  for (const raw of supplyQueue) {
    const a = getAddress(raw)
    if (a !== r) out.push(a)
  }
  return out
}

/**
 * Off-chain check matching vault `validateSupplyQueue`: every listed market must have cap &gt; 0 in the map.
 * Missing keys fail (e.g. market only in supply queue and not loaded in withdraw state).
 */
export function newSupplyQueueHasPositiveCaps(newQueue: string[], capByMarket: Map<string, bigint>): boolean {
  for (const a of newQueue) {
    const k = getAddress(a)
    const cap = capByMarket.get(k) ?? Z
    if (cap <= Z) return false
  }
  return true
}

/** New withdraw queue indices after dropping `removedIndex` from the previous queue. */
export function buildWithdrawQueueIndexesAfterRemoval(removedIndex: number, previousLength: number): bigint[] {
  if (removedIndex < 0 || removedIndex >= previousLength) {
    throw new Error('Invalid market index to remove.')
  }
  const out: bigint[] = []
  for (let i = 0; i < previousLength; i++) {
    if (i !== removedIndex) out.push(BigInt(i))
  }
  return out
}

const CAP_ARG_ZERO = BigInt(0)

export type EncodeWithdrawMarketRemovalParams = {
  /** Omit or pass `null` to skip `reallocate` (no vault liquidity to move). */
  allocations: MarketAllocationTuple[] | null
  removedMarket: string
  newQueueIndexes: bigint[]
  /** `submitCap(market, 0)` — only when current cap &gt; 0 (lowering applies immediately on-chain). */
  includeSubmitCapZero: boolean
  /**
   * When set (including `[]`), appends `setSupplyQueue` after `updateWithdrawQueue` in the same `multicall`.
   * Omit to leave the supply queue unchanged.
   */
  newSupplyQueue?: string[]
}

/**
 * Single Safe tx: optional `reallocate`, optional `submitCap(0)`, then `updateWithdrawQueue`.
 * Order matches on-chain prerequisites (empty market before zeroing cap is the safe curator order).
 */
export function encodeWithdrawMarketRemovalBundle(params: EncodeWithdrawMarketRemovalParams): `0x${string}` {
  const inners: string[] = []
  if (params.allocations != null && params.allocations.length > 0) {
    inners.push(vaultIface.encodeFunctionData('reallocate', [params.allocations]))
  }
  if (params.includeSubmitCapZero) {
    inners.push(
      vaultIface.encodeFunctionData('submitCap', [getAddress(params.removedMarket), CAP_ARG_ZERO])
    )
  }
  inners.push(vaultIface.encodeFunctionData('updateWithdrawQueue', [params.newQueueIndexes]))
  if (params.newSupplyQueue !== undefined) {
    const addrs = params.newSupplyQueue.map((a) => getAddress(a))
    inners.push(vaultIface.encodeFunctionData('setSupplyQueue', [addrs]))
  }

  if (inners.length === 1) {
    return inners[0] as `0x${string}`
  }
  return vaultIface.encodeFunctionData('multicall', [inners]) as `0x${string}`
}

export function encodeUpdateWithdrawQueueOnly(newQueueIndexes: bigint[]): `0x${string}` {
  return vaultIface.encodeFunctionData('updateWithdrawQueue', [newQueueIndexes]) as `0x${string}`
}

export async function proposeReallocateRemoveWithdrawQueueViaSafe(params: {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  vaultAddress: string
  proposerAccount: string
  /** Calldata sent to the vault (single call or `multicall`). */
  vaultCalldata: `0x${string}`
}): Promise<void> {
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Submit the multicall from Safe{Wallet} manually.'
    )
  }

  const safeAddress = getAddress(params.safeAddress)
  const vaultAddress = getAddress(params.vaultAddress)
  const sender = getAddress(params.proposerAccount)

  const apiKit = new SafeApiKit({
    chainId: BigInt(params.chainId),
    txServiceUrl: baseUrl,
  })

  const protocolKit = await Safe.init({
    provider: params.ethereum,
    signer: sender,
    safeAddress,
  })

  const safeTransaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: vaultAddress,
        value: '0',
        data: params.vaultCalldata,
        operation: OperationType.Call,
      },
    ],
  })

  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signature = await protocolKit.signHash(safeTxHash)

  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: sender,
    senderSignature: signature.data,
    origin: SAFE_TX_ORIGIN,
  })
}

export type ReallocateRemoveWithdrawParams = {
  ethereum: Eip1193Provider
  provider: Provider
  chainId: number
  vaultAddress: string
  ownerAddress: string
  ownerKind: OwnerKind
  connectedAccount: string
  /** Calldata for a single call on the vault (e.g. `multicall` or `updateWithdrawQueue`). */
  vaultCalldata: `0x${string}`
}

const ERR_NOT_OWNER_NOR_SAFE_SIGNER =
  'The connected wallet is not listed as an owner of this Safe.'

export type ReallocateRemoveWithdrawSuccess = {
  transactionUrl: string
  successLinkLabel: string
}

/**
 * Proposes a vault transaction via the Transaction Service.
 * This guided flow is only supported when the vault owner is a Gnosis Safe.
 */
export async function proposeReallocateRemoveWithdrawQueueMultisigOnly(
  params: ReallocateRemoveWithdrawParams
): Promise<ReallocateRemoveWithdrawSuccess> {
  const { ownerKind, ownerAddress, connectedAccount, vaultAddress, ethereum, chainId, provider, vaultCalldata } =
    params

  if (ownerKind !== 'safe') {
    throw new Error('This action is only available when the vault owner is a Gnosis Safe (multisig).')
  }

  const isSigner = await isAddressSafeOwner(provider, ownerAddress, connectedAccount)
  if (!isSigner) {
    throw new Error(ERR_NOT_OWNER_NOR_SAFE_SIGNER)
  }

  await proposeReallocateRemoveWithdrawQueueViaSafe({
    ethereum,
    chainId,
    safeAddress: ownerAddress,
    vaultAddress,
    proposerAccount: connectedAccount,
    vaultCalldata,
  })

  const transactionUrl = getSafeWalletQueueUrl(chainId, ownerAddress)
  if (!transactionUrl) {
    throw new Error('Could not build a Safe{Wallet} link for this network.')
  }
  return { transactionUrl, successLinkLabel: 'Open queue' }
}
