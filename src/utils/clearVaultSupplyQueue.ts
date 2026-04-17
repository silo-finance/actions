import SafeApiKit from '@safe-global/api-kit'
import Safe from '@safe-global/protocol-kit'
import { OperationType } from '@safe-global/types-kit'
import { Contract, getAddress, type Provider, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { encodeSetSupplyQueueEmpty } from '@/utils/encodeSetSupplyQueue'
import { getLegacySafeTransactionServiceBaseUrl } from '@/utils/safeTransactionServiceUrl'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { getExplorerTxUrl } from '@/utils/networks'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import { CLEAR_SUPPLY_QUEUE_DENIED_MESSAGE, classifyAllocatorVaultAction } from '@/utils/vaultActionAuthority'
import { sendVaultCallsFromSigner } from '@/utils/vaultMulticall'

const siloVaultAbi = loadAbi(siloVaultArtifact)

const SAFE_TX_ORIGIN = 'Silo Actions: clear supply queue (setSupplyQueue [])'

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

export async function clearSupplyQueueAsAllocator(signer: Signer, vaultAddress: string): Promise<string> {
  const vault = getAddress(vaultAddress)
  const c = new Contract(vault, siloVaultAbi, signer)
  const tx = await c.setSupplyQueue([])
  await tx.wait()
  return tx.hash
}

export async function proposeClearSupplyQueueViaSafe(params: {
  ethereum: Eip1193Provider
  chainId: number
  safeAddress: string
  vaultAddress: string
  proposerAccount: string
}): Promise<void> {
  const baseUrl = getLegacySafeTransactionServiceBaseUrl(params.chainId)
  if (!baseUrl) {
    throw new Error(
      'Safe Transaction Service URL is not configured for this chain. Clear the queue from Safe{Wallet} manually (contract interaction on the vault).'
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

  const data = encodeSetSupplyQueueEmpty()
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [
      {
        to: vaultAddress,
        value: '0',
        data,
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

export type ClearSupplyQueueParams = {
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
}

export type ClearSupplyQueueSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export async function clearSupplyQueueForOwner(
  params: ClearSupplyQueueParams
): Promise<ClearSupplyQueueSuccess> {
  const {
    ownerKind,
    curatorKind,
    ownerAddress,
    curatorAddress,
    connectedAccount,
    vaultAddress,
    signer,
    ethereum,
    chainId,
    provider,
  } = params

  const auth = await classifyAllocatorVaultAction(
    provider,
    vaultAddress,
    connectedAccount,
    { owner: ownerAddress, curator: curatorAddress },
    ownerKind,
    curatorKind
  )

  if (auth.mode === 'denied') {
    throw new Error(CLEAR_SUPPLY_QUEUE_DENIED_MESSAGE)
  }

  if (auth.mode === 'direct') {
    const txHash = await clearSupplyQueueAsAllocator(signer, vaultAddress)
    const transactionUrl = getExplorerTxUrl(chainId, txHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (auth.mode === 'safe_as_wallet' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    /** Safe is the connected wallet: one `eth_sendTransaction` → Safe{Wallet} queues a proposal. */
    await sendVaultCallsFromSigner(signer, vaultAddress, [encodeSetSupplyQueueEmpty()])
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_wallet_queue' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeClearSupplyQueueViaSafe({
      ethereum,
      chainId,
      safeAddress,
      vaultAddress,
      proposerAccount: connectedAccount,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw new Error(CLEAR_SUPPLY_QUEUE_DENIED_MESSAGE)
}
