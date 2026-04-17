import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import { Interface, getAddress, MaxUint256, type Provider, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { getExplorerTxUrl } from '@/utils/networks'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import {
  classifyAllocatorVaultAction,
  classifyOwnerOrCuratorVaultAction,
  WITHDRAW_REMOVAL_DENIED_MESSAGE,
} from '@/utils/vaultActionAuthority'
import {
  executeTargetedBatchFromSigner,
  sendTargetedBatchFromSigner,
  type TargetedCall,
} from '@/utils/vaultMulticall'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const vaultIface = new Interface(siloVaultAbi)

export type MarketAllocationTuple = { market: string; assets: bigint }

export function vaultCalldatasToTargetedCalls(vaultAddress: string, datas: `0x${string}`[]): TargetedCall[] {
  const v = getAddress(vaultAddress)
  return datas.map((data) => ({ to: v, data }))
}

const SAFE_TX_ORIGIN =
  'Silo Actions: withdraw-queue removal (separate vault calls via Safe batch / MultiSend)'

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
   * When set (including `[]`), appends `setSupplyQueue` after `updateWithdrawQueue` in the same Safe batch.
   * Omit to leave the supply queue unchanged.
   */
  newSupplyQueue?: string[]
}

/**
 * Ordered vault calldata for withdraw-queue removal: separate top-level calls (no `vault.multicall`).
 * Safe `createTransaction({ transactions })` batches these as one Safe exec (typically MultiSend).
 * Order matches on-chain prerequisites (empty market before zeroing cap is the safe curator order).
 */
export function buildWithdrawMarketRemovalVaultCallDatas(
  params: EncodeWithdrawMarketRemovalParams
): `0x${string}`[] {
  const out: `0x${string}`[] = []
  if (params.allocations != null && params.allocations.length > 0) {
    out.push(vaultIface.encodeFunctionData('reallocate', [params.allocations]) as `0x${string}`)
  }
  if (params.includeSubmitCapZero) {
    out.push(
      vaultIface.encodeFunctionData('submitCap', [getAddress(params.removedMarket), CAP_ARG_ZERO]) as `0x${string}`
    )
  }
  out.push(vaultIface.encodeFunctionData('updateWithdrawQueue', [params.newQueueIndexes]) as `0x${string}`)
  if (params.newSupplyQueue !== undefined) {
    const addrs = params.newSupplyQueue.map((a) => getAddress(a))
    out.push(vaultIface.encodeFunctionData('setSupplyQueue', [addrs]) as `0x${string}`)
  }
  return out
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
  /** Ordered calls; each `to` may be the vault or another contract (e.g. ERC-20 + ERC-4626 dust top-up). */
  batchCalls: TargetedCall[]
  /** Defaults to withdraw-queue removal origin. */
  origin?: string
}): Promise<void> {
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Submit the transaction from Safe{Wallet} manually.'
    )
  }

  const safeAddress = getAddress(params.safeAddress)
  const sender = getAddress(params.proposerAccount)

  if (params.batchCalls.length === 0) {
    throw new Error('No vault calls to propose.')
  }

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
    transactions: params.batchCalls.map((c) => ({
      to: getAddress(c.to),
      value: '0',
      data: c.data,
      operation: OperationType.Call,
    })),
  })

  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction)
  const signature = await protocolKit.signHash(safeTxHash)

  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash,
    senderAddress: sender,
    senderSignature: signature.data,
    origin: params.origin ?? SAFE_TX_ORIGIN,
  })
}

export type ReallocateRemoveWithdrawSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export type ExecuteReallocateRemoveWithdrawQueueParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  vaultAddress: string
  ownerAddress: string
  curatorAddress: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
  connectedAccount: string
  /**
   * When true, every call in the batch must be allowed for `onlyCuratorRole` ∩ `onlyAllocatorRole`,
   * i.e. the connected wallet acts as vault **owner** or **curator** (SiloVault). Set when the batch
   * includes `submitCap`.
   */
  requiresOwnerOrCuratorCapabilities: boolean
  batchCalls: TargetedCall[]
}

/**
 * Runs the withdraw-removal batch: direct `vault.multicall` (or a single tx) from the wallet, or one
 * Proposed transaction executed as the vault **owner** or **curator** (when that role is a contract wallet).
 */
export async function executeReallocateRemoveWithdrawQueue(
  params: ExecuteReallocateRemoveWithdrawQueueParams
): Promise<ReallocateRemoveWithdrawSuccess> {
  const {
    ethereum,
    provider,
    signer,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    curatorKind,
    connectedAccount,
    requiresOwnerOrCuratorCapabilities,
    batchCalls,
  } = params

  if (batchCalls.length === 0) {
    throw new Error('No vault calls to execute.')
  }

  const overview = { owner: ownerAddress, curator: curatorAddress }
  const auth = requiresOwnerOrCuratorCapabilities
    ? await classifyOwnerOrCuratorVaultAction(provider, connectedAccount, overview, ownerKind, curatorKind)
    : await classifyAllocatorVaultAction(
        provider,
        vaultAddress,
        connectedAccount,
        overview,
        ownerKind,
        curatorKind
      )

  if (auth.mode === 'denied') {
    throw new Error(WITHDRAW_REMOVAL_DENIED_MESSAGE)
  }

  if (auth.mode === 'direct') {
    const txHash = await executeTargetedBatchFromSigner(signer, vaultAddress, batchCalls)
    const transactionUrl = getExplorerTxUrl(chainId, txHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (auth.mode === 'safe_as_wallet' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    /**
     * Safe is the connected wallet: each `eth_sendTransaction` becomes its own Safe proposal in the
     * queue. Contiguous vault calls still get packed into `vault.multicall`, so a no-dust flow is one
     * proposal; with dust top-up (ERC-20 approve + ERC-4626 deposit + vault batch) the Safe receives
     * three separate pending transactions in the queue.
     */
    await sendTargetedBatchFromSigner(signer, vaultAddress, batchCalls)
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_wallet_queue' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeReallocateRemoveWithdrawQueueViaSafe({
      ethereum,
      chainId,
      safeAddress,
      vaultAddress,
      proposerAccount: connectedAccount,
      batchCalls,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw new Error(WITHDRAW_REMOVAL_DENIED_MESSAGE)
}

export type { TargetedCall } from '@/utils/vaultMulticall'
