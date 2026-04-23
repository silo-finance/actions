import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import { getAddress, Interface, type Provider, type Signer } from 'ethers'
import manageableOracleArtifact from '@/abis/ManageableOracle.json'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { loadAbi } from '@/utils/loadAbi'
import { getExplorerTxUrl } from '@/utils/networks'
import type { OwnerKind } from '@/utils/ownerKind'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import { isAddressSafeOwner } from '@/utils/safeOwnerList'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import { sendSafeWalletBatch, type TargetedCall } from '@/utils/vaultMulticall'

const manageableOracleAbi = loadAbi(manageableOracleArtifact)
const oracleIface = new Interface(manageableOracleAbi)

const SAFE_TX_ORIGIN_PROPOSE = 'Silo Actions: propose solvency oracle (RevertingOracle)'
const SAFE_TX_ORIGIN_CANCEL = 'Silo Actions: cancel pending oracle'

export type ManageableOracleExecutionMode = 'direct' | 'safe_as_wallet' | 'safe_propose' | 'denied'

export type ManageableOracleAuthority = {
  mode: ManageableOracleExecutionMode
  /** Safe that will be `msg.sender` on the oracle (populated in both `safe_as_wallet` and `safe_propose`). */
  executingSafeAddress: string | null
}

/**
 * `ManageableOracle.proposeOracle` / `cancelOracle` are both `onlyOwner`. Routing:
 *  - EOA owner equal to connected account → `direct`.
 *  - Safe owner AND the connected wallet IS that Safe (WC-from-Safe{Wallet} / Safe Apps iframe /
 *    Rabby impersonate) → `safe_as_wallet` (one `eth_sendTransaction` turns into a Safe proposal).
 *  - Safe owner AND the connected EOA is a signer on the Safe → `safe_propose` (push a pending
 *    proposal to the Safe Transaction Service so other signers can co-sign).
 *  - Otherwise → `denied`.
 */
export async function classifyManageableOracleAction(
  provider: Provider,
  connectedAccount: string,
  ownerAddress: string,
  ownerKind: OwnerKind
): Promise<ManageableOracleAuthority> {
  const connected = getAddress(connectedAccount)
  const owner = getAddress(ownerAddress)

  if (ownerKind === 'safe' && connected === owner) {
    return { mode: 'safe_as_wallet', executingSafeAddress: owner }
  }
  if (connected === owner) {
    return { mode: 'direct', executingSafeAddress: null }
  }
  if (ownerKind === 'safe' && (await isAddressSafeOwner(provider, owner, connectedAccount))) {
    return { mode: 'safe_propose', executingSafeAddress: owner }
  }
  return { mode: 'denied', executingSafeAddress: null }
}

export const MANAGEABLE_ORACLE_DENIED_MESSAGE =
  'You cannot change this oracle with the connected wallet. Connect as the oracle owner (directly or as a Safe signer).'

/**
 * Short human-readable hints for the custom errors emitted by `ManageableOracle`. Falls back to
 * the generic RPC error message when none match — the raw `toUserErrorMessage` output is always
 * returned as a tail so developers can still see the underlying cause in the UI.
 */
export function manageableOracleErrorHint(err: unknown): string | null {
  const msg = toUserErrorMessage(err)
  const lower = msg.toLowerCase()
  if (lower.includes('onlyowner')) return 'Only the oracle owner can submit this transaction.'
  if (lower.includes('pendingoracleupdate') || lower.includes('pendingupdate')) {
    return 'A pending oracle update already exists. Cancel it before proposing a new one.'
  }
  if (lower.includes('nochange')) return 'The proposed oracle equals the current oracle — nothing to update.'
  if (lower.includes('zerooracle')) return 'Proposed oracle address is zero.'
  if (lower.includes('basetokenmustbethesame')) return "New oracle's base token must match the current oracle."
  if (lower.includes('quotetokenmustbethesame')) return "New oracle's quote token must match the current oracle."
  if (lower.includes('oraclequotefailed')) return 'Proposed oracle rejected a sanity-check quote call.'
  if (lower.includes('nopendingupdatetocancel')) return 'There is no pending oracle update to cancel.'
  return null
}

export type ManageableOracleCall = {
  oracleAddress: string
  method: 'proposeOracle' | 'cancelOracle'
  /** Required when `method === 'proposeOracle'`. */
  newOracle?: string
}

export type ManageableOracleActionSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export type ExecuteManageableOracleParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  connectedAccount: string
  ownerAddress: string
  ownerKind: OwnerKind
  call: ManageableOracleCall
}

/** Single-target propose / cancel with `estimateGas` preflight and Safe routing. */
export async function executeManageableOracleAction(
  params: ExecuteManageableOracleParams
): Promise<ManageableOracleActionSuccess> {
  return executeManageableOracleBatch({
    ethereum: params.ethereum,
    provider: params.provider,
    signer: params.signer,
    chainId: params.chainId,
    connectedAccount: params.connectedAccount,
    calls: [params.call],
    sharedOwner: { address: params.ownerAddress, kind: params.ownerKind },
  })
}

export type ExecuteManageableOracleBatchParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  connectedAccount: string
  calls: ManageableOracleCall[]
  /**
   * Owner shared by every call. Populate when the caller has already confirmed that every oracle in
   * `calls` has the same owner — we then route the whole batch through the same Safe (or EOA) path.
   * Pass `null` to refuse batching (callers should execute the calls sequentially instead).
   */
  sharedOwner: { address: string; kind: OwnerKind } | null
}

/**
 * Bundles multiple propose/cancel calls into ONE Safe proposal when `sharedOwner` is a Safe; falls
 * back to sequential direct transactions when the owner is an EOA equal to the connected account.
 *
 * Refuses to run with `sharedOwner = null` — callers must loop
 * {@link executeManageableOracleAction} instead when the targets do not share an owner.
 */
export async function executeManageableOracleBatch(
  params: ExecuteManageableOracleBatchParams
): Promise<ManageableOracleActionSuccess> {
  const { ethereum, provider, signer, chainId, connectedAccount, calls, sharedOwner } = params
  if (calls.length === 0) {
    throw new Error('No oracle calls to execute.')
  }
  if (!sharedOwner) {
    throw new Error('Targets do not share an owner — use per-target submissions.')
  }

  const auth = await classifyManageableOracleAction(
    provider,
    connectedAccount,
    sharedOwner.address,
    sharedOwner.kind
  )

  if (auth.mode === 'denied') {
    throw new Error(MANAGEABLE_ORACLE_DENIED_MESSAGE)
  }

  const targetedCalls = buildTargetedCalls(calls)

  if (auth.mode === 'direct') {
    const lastHash = await executeDirectSequential(signer, targetedCalls)
    const transactionUrl = getExplorerTxUrl(chainId, lastHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (auth.mode === 'safe_as_wallet' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await sendSafeWalletBatch({
      ethereum,
      chainId,
      from: safeAddress,
      calls: targetedCalls,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_wallet_queue' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeManageableOracleBatchViaSafe({
      ethereum,
      chainId,
      safeAddress,
      proposerAccount: connectedAccount,
      batchCalls: targetedCalls,
      origin: calls.every((c) => c.method === 'cancelOracle') ? SAFE_TX_ORIGIN_CANCEL : SAFE_TX_ORIGIN_PROPOSE,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw new Error(MANAGEABLE_ORACLE_DENIED_MESSAGE)
}

function buildTargetedCalls(calls: ManageableOracleCall[]): TargetedCall[] {
  return calls.map((c) => ({ to: getAddress(c.oracleAddress), data: encodeCall(c) }))
}

function encodeCall(call: ManageableOracleCall): `0x${string}` {
  if (call.method === 'proposeOracle') {
    if (!call.newOracle) throw new Error('proposeOracle requires newOracle.')
    return oracleIface.encodeFunctionData('proposeOracle', [getAddress(call.newOracle)]) as `0x${string}`
  }
  return oracleIface.encodeFunctionData('cancelOracle', []) as `0x${string}`
}

/**
 * Runs each call sequentially from the signer with an `estimateGas` preflight per call. Every
 * prompt is one wallet popup; if call #2 would revert we surface the decoded custom error before
 * the user accepts call #1 — we estimate BOTH calls upfront.
 */
async function executeDirectSequential(signer: Signer, calls: TargetedCall[]): Promise<string> {
  for (const c of calls) {
    try {
      await signer.estimateGas({ to: c.to, data: c.data })
    } catch (e) {
      const hint = manageableOracleErrorHint(e)
      const base = toUserErrorMessage(e, 'Could not simulate the oracle update.')
      throw new Error(hint ? `${hint} (${base})` : base)
    }
  }
  let lastHash = ''
  for (const c of calls) {
    const tx = await signer.sendTransaction({ to: c.to, data: c.data })
    const receipt = await tx.wait()
    lastHash = receipt?.hash ?? tx.hash
  }
  return lastHash
}

async function proposeManageableOracleBatchViaSafe(params: {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  proposerAccount: string
  batchCalls: TargetedCall[]
  origin: string
}): Promise<void> {
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Submit the transaction from Safe{Wallet} manually.'
    )
  }
  if (params.batchCalls.length === 0) {
    throw new Error('No oracle calls to propose.')
  }

  const safeAddress = getAddress(params.safeAddress)
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
    origin: params.origin,
  })
}
