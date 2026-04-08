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
import { isAddressSafeOwner } from '@/utils/safeOwnerList'

const siloVaultAbi = loadAbi(siloVaultArtifact)

const SAFE_TX_ORIGIN = 'Silo Actions: clear supply queue (setSupplyQueue [])'

export type Eip1193Provider = {
  // MetaMask types use `unknown[]`; protocol-kit accepts EIP-1193 shape
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

function sameSignerOwner(owner: string, account: string): boolean {
  try {
    return getAddress(owner) === getAddress(account)
  } catch {
    return false
  }
}

export async function clearSupplyQueueAsVaultOwner(signer: Signer, vaultAddress: string): Promise<string> {
  const vault = getAddress(vaultAddress)
  const c = new Contract(vault, siloVaultAbi, signer)
  const tx = await c.setSupplyQueue([])
  await tx.wait()
  return tx.hash
}

/**
 * Propose a Safe tx: vault.setSupplyQueue([]). Uses legacy tx service URL (no API key).
 * Caller must be a Safe owner; wallet signs the Safe tx hash.
 */
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
  ownerKind: OwnerKind
  connectedAccount: string
}

const ERR_NOT_VAULT_OWNER = 'The connected wallet is not the vault owner.'
const ERR_NOT_OWNER_NOR_SAFE_SIGNER =
  'The connected wallet is not the vault owner and is not listed as an owner of this Safe.'

export type ClearSupplyQueueSuccess = {
  transactionUrl: string
  /** Anchor text for the success link (explorer vs Safe queue). */
  successLinkLabel: string
}

export async function clearSupplyQueueForOwner(
  params: ClearSupplyQueueParams
): Promise<ClearSupplyQueueSuccess> {
  const {
    ownerKind,
    ownerAddress,
    connectedAccount,
    vaultAddress,
    signer,
    ethereum,
    chainId,
    provider,
  } = params

  if (ownerKind === 'contract') {
    throw new Error(
      'The vault owner is a contract that is not a Gnosis Safe. Perform the call from that owner contract.'
    )
  }

  if (ownerKind === 'eoa') {
    if (sameSignerOwner(ownerAddress, connectedAccount)) {
      const txHash = await clearSupplyQueueAsVaultOwner(signer, vaultAddress)
      const transactionUrl = getExplorerTxUrl(chainId, txHash)
      if (!transactionUrl) {
        throw new Error('Could not build a block explorer link for this network.')
      }
      return { transactionUrl, successLinkLabel: 'View on explorer' }
    }
    throw new Error(ERR_NOT_VAULT_OWNER)
  }

  if (ownerKind === 'safe') {
    const isSigner = await isAddressSafeOwner(provider, ownerAddress, connectedAccount)
    if (isSigner) {
      await proposeClearSupplyQueueViaSafe({
        ethereum,
        chainId,
        safeAddress: ownerAddress,
        vaultAddress,
        proposerAccount: connectedAccount,
      })
      const transactionUrl = getSafeWalletQueueUrl(chainId, ownerAddress)
      if (!transactionUrl) {
        throw new Error('Could not build a Safe{Wallet} link for this network.')
      }
      return { transactionUrl, successLinkLabel: 'Open queue' }
    }
    throw new Error(ERR_NOT_OWNER_NOR_SAFE_SIGNER)
  }

  const _exhaustive: never = ownerKind
  throw new Error(`Unsupported owner type: ${_exhaustive}`)
}
