import { getAddress, Interface, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))

/**
 * Sends one or more vault calls as a single on-chain tx: `multicall(bytes[])` when &gt;1, else a
 * single `sendTransaction` (same `msg.sender` for each inner call).
 */
export async function executeVaultCallsFromSigner(
  signer: Signer,
  vaultAddress: string,
  callDatas: `0x${string}`[]
): Promise<string> {
  const to = getAddress(vaultAddress)
  if (callDatas.length === 0) {
    throw new Error('No vault calls to execute.')
  }
  if (callDatas.length === 1) {
    const tx = await signer.sendTransaction({ to, data: callDatas[0] })
    const receipt = await tx.wait()
    return receipt?.hash ?? tx.hash
  }
  const data = vaultIface.encodeFunctionData('multicall', [callDatas]) as `0x${string}`
  const tx = await signer.sendTransaction({ to, data })
  const receipt = await tx.wait()
  return receipt?.hash ?? tx.hash
}
