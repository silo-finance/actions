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
