import { getAddress, Interface, type Provider, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { encodeSetSupplyQueue } from '@/utils/encodeSetSupplyQueue'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import {
  classifySetSupplyQueueExecution,
  SET_SUPPLY_QUEUE_ROLES_DESCRIPTION,
} from '@/utils/connectedVaultRole'
import { getExplorerTxUrl } from '@/utils/networks'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { proposeReallocateRemoveWithdrawQueueViaSafe } from '@/utils/reallocateRemoveWithdrawMarket'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const vaultIface = new Interface(siloVaultAbi)

const SAFE_BATCH_ORIGIN = 'Silo Actions: acceptCap + set supply queue'

/** Ordered vault calls: one `acceptCap` per market (timelock elapsed, cap still zero), then `setSupplyQueue`. */
export function buildSupplyQueueUpdateVaultCallDatas(params: {
  acceptCapMarketsInOrder: string[]
  newSupplyQueue: string[]
}): `0x${string}`[] {
  const out: `0x${string}`[] = []
  for (const raw of params.acceptCapMarketsInOrder) {
    const m = getAddress(raw)
    out.push(vaultIface.encodeFunctionData('acceptCap', [m]) as `0x${string}`)
  }
  out.push(encodeSetSupplyQueue(params.newSupplyQueue))
  return out
}

async function executeVaultCallsFromSigner(
  signer: Signer,
  vaultAddress: string,
  callDatas: `0x${string}`[]
): Promise<string> {
  const to = getAddress(vaultAddress)
  let lastHash = ''
  for (const data of callDatas) {
    const tx = await signer.sendTransaction({ to, data })
    const receipt = await tx.wait()
    lastHash = receipt?.hash ?? tx.hash
  }
  return lastHash
}

export type SetSupplyQueueParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  vaultAddress: string
  ownerAddress: string
  /** Vault `curator()` — required to match SiloVault `onlyAllocatorRole` for direct callers. */
  curatorAddress: string
  ownerKind: OwnerKind
  connectedAccount: string
  newSupplyQueue: string[]
  /**
   * Markets that need `acceptCap` before `setSupplyQueue` (on-chain `cap == 0`, pending value set,
   * timelock elapsed). Order is execution order (typically top-to-bottom in the target queue).
   */
  marketsToAcceptCapFirst?: string[]
}

function errNoSetSupplyQueuePermission(): Error {
  return new Error(
    `You cannot change the supply queue with this wallet. Only ${SET_SUPPLY_QUEUE_ROLES_DESCRIPTION}`
  )
}

export type SetSupplyQueueSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export async function setSupplyQueueForOwner(params: SetSupplyQueueParams): Promise<SetSupplyQueueSuccess> {
  const {
    ownerKind,
    ownerAddress,
    curatorAddress,
    connectedAccount,
    vaultAddress,
    signer,
    ethereum,
    chainId,
    provider,
    newSupplyQueue,
    marketsToAcceptCapFirst = [],
  } = params

  const mode = await classifySetSupplyQueueExecution(provider, vaultAddress, connectedAccount, {
    owner: ownerAddress,
    curator: curatorAddress,
  }, ownerKind)

  if (mode === 'denied') {
    throw errNoSetSupplyQueuePermission()
  }

  const acceptOrdered = marketsToAcceptCapFirst.map((a) => getAddress(a))
  const callDatas =
    acceptOrdered.length > 0
      ? buildSupplyQueueUpdateVaultCallDatas({
          acceptCapMarketsInOrder: acceptOrdered,
          newSupplyQueue,
        })
      : ([encodeSetSupplyQueue(newSupplyQueue)] as `0x${string}`[])

  if (mode === 'direct') {
    const txHash = await executeVaultCallsFromSigner(signer, vaultAddress, callDatas)
    const transactionUrl = getExplorerTxUrl(chainId, txHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (mode === 'safe_propose') {
    await proposeReallocateRemoveWithdrawQueueViaSafe({
      ethereum,
      chainId,
      safeAddress: getAddress(ownerAddress),
      vaultAddress,
      proposerAccount: connectedAccount,
      vaultCallDatas: callDatas,
      origin: acceptOrdered.length > 0 ? SAFE_BATCH_ORIGIN : 'Silo Actions: set supply queue',
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, ownerAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  const _exhaustive: never = mode
  throw new Error(`Unsupported execution mode: ${_exhaustive}`)
}
