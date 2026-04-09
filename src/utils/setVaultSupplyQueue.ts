import { getAddress, Interface, type Provider, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { encodeSetSupplyQueue } from '@/utils/encodeSetSupplyQueue'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { SET_SUPPLY_QUEUE_ROLES_DESCRIPTION } from '@/utils/connectedVaultRole'
import { getExplorerTxUrl } from '@/utils/networks'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import { proposeReallocateRemoveWithdrawQueueViaSafe } from '@/utils/reallocateRemoveWithdrawMarket'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import { classifyAllocatorVaultAction } from '@/utils/vaultActionAuthority'
import { executeVaultCallsFromSigner } from '@/utils/vaultMulticall'

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

export type SetSupplyQueueParams = {
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
  newSupplyQueue: string[]
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
    ownerKind,
    curatorKind,
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

  if (auth.mode === 'direct') {
    const txHash = await executeVaultCallsFromSigner(signer, vaultAddress, callDatas)
    const transactionUrl = getExplorerTxUrl(chainId, txHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeReallocateRemoveWithdrawQueueViaSafe({
      ethereum,
      chainId,
      safeAddress,
      vaultAddress,
      proposerAccount: connectedAccount,
      vaultCallDatas: callDatas,
      origin: acceptOrdered.length > 0 ? SAFE_BATCH_ORIGIN : 'Silo Actions: set supply queue',
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw errNoSetSupplyQueuePermission()
}
