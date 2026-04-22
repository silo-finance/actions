import { Contract, getAddress, type Signer } from 'ethers'
import globalPauseArtifact from '@/abis/GlobalPause.json'
import { loadAbi } from '@/utils/loadAbi'
import { getExplorerTxUrl } from '@/utils/networks'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'

const globalPauseAbi = loadAbi(globalPauseArtifact)

export type GlobalPauseWriteSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export type GlobalPauseWriteParams = {
  signer: Signer
  chainId: number
  globalPauseAddress: string
}

/**
 * Direct EOA broadcast for `pauseAll` — Safe/multisig propose flow is intentionally out of scope
 * in v1 (section is built for the single-person emergency pause role).
 */
export async function pauseAllGlobal(params: GlobalPauseWriteParams): Promise<GlobalPauseWriteSuccess> {
  return executeGlobalPauseAction(params, 'pauseAll')
}

/** Direct EOA broadcast for `unpauseAll`. Same direct-only contract as `pauseAllGlobal`. */
export async function unpauseAllGlobal(params: GlobalPauseWriteParams): Promise<GlobalPauseWriteSuccess> {
  return executeGlobalPauseAction(params, 'unpauseAll')
}

export type GlobalPauseContractWriteParams = GlobalPauseWriteParams & {
  contractAddress: string
}

/** Direct EOA broadcast for `addContract(address)` with estimateGas preflight. */
export async function addGlobalPauseContract(
  params: GlobalPauseContractWriteParams
): Promise<GlobalPauseWriteSuccess> {
  return executeGlobalPauseAddressAction(params, 'addContract')
}

/** Direct EOA broadcast for `removeContract(address)` with estimateGas preflight. */
export async function removeGlobalPauseContract(
  params: GlobalPauseContractWriteParams
): Promise<GlobalPauseWriteSuccess> {
  return executeGlobalPauseAddressAction(params, 'removeContract')
}

/**
 * Direct EOA broadcast for `GlobalPause.acceptOwnership(address _contract)`. Global Pause
 * must already be `pendingOwner` on the target — the call makes Global Pause invoke
 * `_contract.acceptOwnership()` under the hood, completing the Ownable2Step handshake.
 */
export async function acceptGlobalPauseContractOwnership(
  params: GlobalPauseContractWriteParams
): Promise<GlobalPauseWriteSuccess> {
  return executeGlobalPauseAddressAction(params, 'acceptOwnership')
}

async function executeGlobalPauseAction(
  { signer, chainId, globalPauseAddress }: GlobalPauseWriteParams,
  method: 'pauseAll' | 'unpauseAll'
): Promise<GlobalPauseWriteSuccess> {
  const target = getAddress(globalPauseAddress)
  const contract = new Contract(target, globalPauseAbi, signer)
  /**
   * estimateGas preflight: surface `onlySigner`/custom reverts as decoded errors BEFORE we open
   * the wallet prompt, and reuse the returned gas value for the send (policy §4).
   */
  const estimatedGas = await contract[method].estimateGas()
  const tx = await contract[method]({ gasLimit: estimatedGas })
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

/**
 * GlobalPause exposes two `acceptOwnership` overloads (no-arg for itself, `(address)` for the
 * tracked contract). Use the fully-qualified signature so ethers always picks the one that
 * takes a target address — otherwise the Contract proxy would have to guess.
 */
const ADDRESS_ACTION_SIGNATURE: Record<'addContract' | 'removeContract' | 'acceptOwnership', string> = {
  addContract: 'addContract',
  removeContract: 'removeContract',
  acceptOwnership: 'acceptOwnership(address)',
}

async function executeGlobalPauseAddressAction(
  { signer, chainId, globalPauseAddress, contractAddress }: GlobalPauseContractWriteParams,
  method: 'addContract' | 'removeContract' | 'acceptOwnership'
): Promise<GlobalPauseWriteSuccess> {
  const target = getAddress(globalPauseAddress)
  const contractToModify = getAddress(contractAddress)
  const contract = new Contract(target, globalPauseAbi, signer)
  const fn = contract.getFunction(ADDRESS_ACTION_SIGNATURE[method])
  const estimatedGas = await fn.estimateGas(contractToModify)
  const tx = await fn(contractToModify, { gasLimit: estimatedGas })
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
