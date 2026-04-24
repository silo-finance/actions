import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import dynamicKinkArtifact from '@/abis/DynamicKinkModel.json'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { classifyManageableOracleAction, MANAGEABLE_ORACLE_DENIED_MESSAGE } from '@/utils/manageableOracleAction'
import {
  dynamicKinkIrmConfigToTuple,
  type DynamicKinkIrmConfig,
} from '@/utils/dynamicKinkIrmConfig'
import { loadAbi } from '@/utils/loadAbi'
import { getExplorerTxUrl } from '@/utils/networks'
import type { OwnerKind } from '@/utils/ownerKind'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import { sendSafeWalletBatch, type TargetedCall } from '@/utils/vaultMulticall'
import { getAddress, Interface, type Provider, type Signer } from 'ethers'

const dynamicKinkAbi = loadAbi(dynamicKinkArtifact)
const irmIface = new Interface(dynamicKinkAbi)

const SAFE_TX_ORIGIN = 'Silo Actions: update DynamicKink IRM config'

export type DynamicKinkIrmCall = {
  irmAddress: string
  config: DynamicKinkIrmConfig
}

export type DynamicKinkIrmActionSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export const DYNAMIC_KINK_IRM_DENIED_MESSAGE = MANAGEABLE_ORACLE_DENIED_MESSAGE

function encodeConfigTuple(c: DynamicKinkIrmConfig) {
  return dynamicKinkIrmConfigToTuple(c)
}

export function dynamicKinkIrmErrorHint(err: unknown): string | null {
  const msg = toUserErrorMessage(err)
  const lower = msg.toLowerCase()
  if (lower.includes('onlyowner')) return 'Only the IRM contract owner can submit this transaction.'
  if (lower.includes('pendingconfig') || lower.includes('timelock')) {
    return 'A config update is already pending, or the timelock has not passed yet.'
  }
  if (lower.includes('invalidconfig') || lower.includes('verifyconfig')) {
    return 'The proposed configuration was rejected by verifyConfig (invalid shape or bounds).'
  }
  return null
}

function encodeUpdateConfig(irmAddress: string, c: DynamicKinkIrmConfig): TargetedCall {
  const data = irmIface.encodeFunctionData('updateConfig', [encodeConfigTuple(c)]) as `0x${string}`
  return { to: getAddress(irmAddress), data }
}

function encodeVerifyConfig(irmAddress: string, c: DynamicKinkIrmConfig): `0x${string}` {
  return irmIface.encodeFunctionData('verifyConfig', [encodeConfigTuple(c)]) as `0x${string}`
}

/**
 * `verifyConfig` (static) then `updateConfig` gas estimate for every call, before the wallet opens.
 */
async function preflightIrmDirectFromCalls(
  provider: Provider,
  signer: Signer,
  irmCalls: DynamicKinkIrmCall[]
): Promise<void> {
  for (const c of irmCalls) {
    const verifyData = encodeVerifyConfig(c.irmAddress, c.config)
    try {
      await provider.call({ to: c.irmAddress, data: verifyData })
    } catch (e) {
      const hint = dynamicKinkIrmErrorHint(e)
      const base = toUserErrorMessage(e, 'Could not verify the IRM configuration on-chain.')
      throw new Error(hint ? `${hint} (${base})` : base)
    }
  }
  for (const c of irmCalls) {
    const { data } = encodeUpdateConfig(c.irmAddress, c.config)
    try {
      await signer.estimateGas({ to: c.irmAddress, data })
    } catch (e) {
      const hint = dynamicKinkIrmErrorHint(e)
      const base = toUserErrorMessage(e, 'Could not simulate the IRM update.')
      throw new Error(hint ? `${hint} (${base})` : base)
    }
  }
}

async function executeDirectIrmCalls(signer: Signer, irmCalls: DynamicKinkIrmCall[]): Promise<string> {
  const provider = signer.provider
  if (!provider) throw new Error('Wallet provider is not available for simulation.')
  await preflightIrmDirectFromCalls(provider, signer, irmCalls)
  let lastHash = ''
  for (const c of irmCalls) {
    const { to, data } = encodeUpdateConfig(c.irmAddress, c.config)
    const tx = await signer.sendTransaction({ to, data })
    const receipt = await tx.wait()
    lastHash = receipt?.hash ?? tx.hash
  }
  return lastHash
}

async function proposeIrmBatchViaSafe(params: {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  proposerAccount: string
  batchCalls: TargetedCall[]
}): Promise<void> {
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Submit the transaction from Safe{Wallet} manually.'
    )
  }
  if (params.batchCalls.length === 0) {
    throw new Error('No IRM calls to propose.')
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
    origin: SAFE_TX_ORIGIN,
  })
}

function buildIrmTargetedCalls(calls: DynamicKinkIrmCall[]): TargetedCall[] {
  return calls.map((c) => encodeUpdateConfig(c.irmAddress, c.config))
}

export type ExecuteDynamicKinkIrmBatchParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  connectedAccount: string
  calls: DynamicKinkIrmCall[]
  sharedOwner: { address: string; kind: OwnerKind } | null
}

/**
 * Batches one or more `updateConfig` calls when every target shares the same `owner` (and route).
 * Uses `verifyConfig` + `estimateGas` preflight (EOA only).
 */
export async function executeDynamicKinkIrmBatch(
  params: ExecuteDynamicKinkIrmBatchParams
): Promise<DynamicKinkIrmActionSuccess> {
  const { ethereum, provider, signer, chainId, connectedAccount, calls, sharedOwner } = params
  if (calls.length === 0) {
    throw new Error('No IRM config updates to execute.')
  }
  if (!sharedOwner) {
    throw new Error('Targets do not share an owner — use per-IRM submissions.')
  }

  const auth = await classifyManageableOracleAction(
    provider,
    connectedAccount,
    sharedOwner.address,
    sharedOwner.kind
  )

  if (auth.mode === 'denied') {
    throw new Error(DYNAMIC_KINK_IRM_DENIED_MESSAGE)
  }

  const targeted = buildIrmTargetedCalls(calls)

  if (auth.mode === 'direct') {
    const lastHash = await executeDirectIrmCalls(signer, calls)
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
      calls: targeted,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_wallet_queue' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeIrmBatchViaSafe({
      ethereum,
      chainId,
      safeAddress,
      proposerAccount: connectedAccount,
      batchCalls: targeted,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw new Error(DYNAMIC_KINK_IRM_DENIED_MESSAGE)
}

/**
 * One `updateConfig` with the same owner routing as {@link executeDynamicKinkIrmBatch}.
 */
export async function executeDynamicKinkIrmAction(
  params: Omit<ExecuteDynamicKinkIrmBatchParams, 'calls' | 'sharedOwner'> & {
    call: DynamicKinkIrmCall
    ownerAddress: string
    ownerKind: OwnerKind
  }
): Promise<DynamicKinkIrmActionSuccess> {
  return executeDynamicKinkIrmBatch({
    ethereum: params.ethereum,
    provider: params.provider,
    signer: params.signer,
    chainId: params.chainId,
    connectedAccount: params.connectedAccount,
    calls: [params.call],
    sharedOwner: { address: params.ownerAddress, kind: params.ownerKind },
  })
}
