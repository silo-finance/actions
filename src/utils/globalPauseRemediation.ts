import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import { Contract, Interface, getAddress, type Signer } from 'ethers'
import pausableTargetRemediationArtifact from '@/abis/PausableTargetRemediation.json'
import type { GlobalPauseWriteSuccess } from '@/utils/pauseAllGlobal'
import type { RemediationPlan } from '@/utils/globalPauseRemediationAuthority'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import { loadAbi } from '@/utils/loadAbi'
import { getExplorerTxUrl } from '@/utils/networks'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { sendSafeWalletBatch, type TargetedCall } from '@/utils/vaultMulticall'

const remediationAbi = loadAbi(pausableTargetRemediationArtifact)
const remediationIface = new Interface(remediationAbi)

const SAFE_TX_ORIGIN = 'Silo Actions: grant Global Pause authority'

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

function actionMethodName(plan: RemediationPlan): 'transferOwnership' | 'grantRole' {
  return plan.action.kind === 'transferOwnership' ? 'transferOwnership' : 'grantRole'
}

function actionArgs(plan: RemediationPlan, globalPauseAddress: string): unknown[] {
  const gp = getAddress(globalPauseAddress)
  if (plan.action.kind === 'transferOwnership') return [gp]
  return [plan.action.role, gp]
}

/**
 * Encodes one on-chain call that fixes Global Pause authority on `plan.target`.
 * For `transferOwnership` (Ownable/Ownable2Step) calls `transferOwnership(globalPause)` on the
 * target; for `grantRole` (AccessControl) calls `grantRole(PAUSER_ROLE, globalPause)`.
 *
 * The encoded payload is the same regardless of submission path (direct / Safe propose / Safe
 * wallet batch) — we keep the encode step pure so the bulk MultiSend builder can collect them.
 */
export function encodeRemediationCall(
  plan: RemediationPlan,
  globalPauseAddress: string
): TargetedCall {
  const data = remediationIface.encodeFunctionData(
    actionMethodName(plan),
    actionArgs(plan, globalPauseAddress)
  ) as `0x${string}`
  return { to: getAddress(plan.target), data }
}

export type DirectRemediationParams = {
  signer: Signer
  chainId: number
  plan: RemediationPlan
  globalPauseAddress: string
}

/**
 * Direct EOA broadcast. `estimateGas` preflight surfaces access-control reverts (e.g. the user
 * lost the admin role since the plan was built) as decoded errors BEFORE the wallet prompt
 * opens, per senior-coding policy §4.
 */
export async function executeRemediationDirect(
  params: DirectRemediationParams
): Promise<GlobalPauseWriteSuccess> {
  const { signer, chainId, plan, globalPauseAddress } = params
  const target = getAddress(plan.target)
  const contract = new Contract(target, remediationAbi, signer)
  const method = actionMethodName(plan)
  const args = actionArgs(plan, globalPauseAddress)
  const fn = contract.getFunction(method)
  const estimatedGas = await fn.estimateGas(...args)
  const tx = await fn(...args, { gasLimit: estimatedGas })
  await tx.wait()
  const transactionUrl = getExplorerTxUrl(chainId, tx.hash)
  if (!transactionUrl) {
    throw new Error('Could not build a block explorer link for this network.')
  }
  return {
    transactionUrl,
    successLinkLabel: 'View on explorer',
    outcome: 'explorer',
  }
}

export type SafeWalletRemediationParams = {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  calls: TargetedCall[]
}

/**
 * Wallet-is-Safe path — same routing as vault flows: `sendSafeWalletBatch` hands the calls to the
 * Safe wallet (Safe Apps iframe / WalletConnect from Safe{Wallet}), which queues them as one or
 * more proposals internally. Returns a `safe_wallet_queue` outcome pointing at the Safe queue UI.
 */
export async function sendRemediationViaSafeWallet(
  params: SafeWalletRemediationParams
): Promise<GlobalPauseWriteSuccess> {
  if (params.calls.length === 0) {
    throw new Error('No remediation calls to send.')
  }
  const safeAddress = getAddress(params.safeAddress)
  await sendSafeWalletBatch({
    ethereum: params.ethereum,
    chainId: params.chainId,
    from: safeAddress,
    calls: params.calls,
  })
  const transactionUrl = getSafeWalletQueueUrl(params.chainId, safeAddress)
  if (!transactionUrl) {
    throw new Error('Could not build a Safe{Wallet} link for this network.')
  }
  return {
    transactionUrl,
    successLinkLabel: 'Open queue',
    outcome: 'safe_wallet_queue',
  }
}

export type SafeProposeRemediationParams = {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  proposerAccount: string
  calls: TargetedCall[]
}

/**
 * EOA-owner → Safe Transaction Service proposal path. `protocol-kit.createTransaction({
 * transactions: [...] })` automatically wraps multi-call lists in a MultiSend envelope, so both
 * the per-row single-call and the bulk authority batch use the exact same code path.
 */
export async function proposeRemediationViaSafe(
  params: SafeProposeRemediationParams
): Promise<GlobalPauseWriteSuccess> {
  if (params.calls.length === 0) {
    throw new Error('No remediation calls to propose.')
  }
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Submit the grant from Safe{Wallet} manually (contract interaction).'
    )
  }

  const safeAddress = getAddress(params.safeAddress)
  const sender = getAddress(params.proposerAccount)
  const transactions = params.calls.map((c) => ({
    to: getAddress(c.to),
    value: '0',
    data: c.data,
    operation: OperationType.Call,
  }))

  const apiKit = new SafeApiKit({
    chainId: BigInt(params.chainId),
    txServiceUrl: baseUrl,
  })

  const protocolKit = await Safe.init({
    provider: params.ethereum,
    signer: sender,
    safeAddress,
  })

  const safeTransaction = await protocolKit.createTransaction({ transactions })
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

  const transactionUrl = getSafeWalletQueueUrl(params.chainId, safeAddress)
  if (!transactionUrl) {
    throw new Error('Could not build a Safe{Wallet} link for this network.')
  }
  return {
    transactionUrl,
    successLinkLabel: 'Open queue',
    outcome: 'safe_queue',
  }
}

export type ExecuteRemediationParams = {
  signer: Signer
  ethereum: Eip1193Provider | null
  chainId: number
  connectedAccount: string
  globalPauseAddress: string
  plan: RemediationPlan
}

/**
 * High-level per-row dispatcher. Routes to `direct` / `safe_as_wallet` / `safe_propose` based
 * on `plan.mode`. `denied` and unhandled modes throw so the UI surfaces the error path instead
 * of silently no-oping.
 */
export async function executeRemediation(
  params: ExecuteRemediationParams
): Promise<GlobalPauseWriteSuccess> {
  const { signer, ethereum, chainId, connectedAccount, globalPauseAddress, plan } = params

  if (plan.mode.kind === 'denied') {
    throw new Error('Connected wallet is not authorized to remediate this contract.')
  }

  const call = encodeRemediationCall(plan, globalPauseAddress)

  if (plan.mode.kind === 'direct') {
    return executeRemediationDirect({ signer, chainId, plan, globalPauseAddress })
  }

  if (!ethereum) {
    throw new Error('Wallet transport is not available for Safe-routed transactions.')
  }

  if (plan.mode.kind === 'safe_as_wallet') {
    return sendRemediationViaSafeWallet({
      ethereum,
      chainId,
      safeAddress: plan.mode.safeAddress,
      calls: [call],
    })
  }

  return proposeRemediationViaSafe({
    ethereum,
    chainId,
    safeAddress: plan.mode.safeAddress,
    proposerAccount: connectedAccount,
    calls: [call],
  })
}

export type BulkProposeParams = {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  proposerAccount: string
  plans: RemediationPlan[]
  globalPauseAddress: string
}

/**
 * Bulk path: every plan targets the same Safe in `safe_propose` mode. We encode one call per
 * plan and feed the full list into a single `proposeTransaction` call — Safe's protocol-kit
 * folds it into a MultiSend so co-signers see one proposal with N decoded actions.
 */
export async function proposeBulkRemediationViaSafe(
  params: BulkProposeParams
): Promise<GlobalPauseWriteSuccess> {
  const { plans, globalPauseAddress } = params
  if (plans.length === 0) {
    throw new Error('No remediation plans to batch.')
  }
  const calls = plans.map((p) => encodeRemediationCall(p, globalPauseAddress))
  return proposeRemediationViaSafe({
    ethereum: params.ethereum,
    chainId: params.chainId,
    safeAddress: params.safeAddress,
    proposerAccount: params.proposerAccount,
    calls,
  })
}

/** UI label for the action button. Kept here so the component doesn't branch on mode strings. */
export function remediationButtonLabel(plan: RemediationPlan): string {
  const verb = plan.action.kind === 'transferOwnership' ? 'Transfer ownership' : 'Grant role'
  if (plan.mode.kind === 'direct') return verb
  if (plan.mode.kind === 'safe_as_wallet') return `${verb} (Safe)`
  if (plan.mode.kind === 'safe_propose') return `${verb} (via Safe)`
  return verb
}
