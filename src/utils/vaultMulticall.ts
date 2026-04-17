import { getAddress, Interface, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))

/** One on-chain call in a batch (same or different `to` contracts). */
export type TargetedCall = {
  to: string
  data: `0x${string}`
}

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

/**
 * Runs calls in order: non-vault targets one tx each, then each **contiguous** run of vault calls is sent as
 * `multicall` (or a single vault call) so dust top-ups do not split the vault batch.
 */
export async function executeTargetedBatchFromSigner(
  signer: Signer,
  vaultAddress: string,
  calls: TargetedCall[]
): Promise<string> {
  if (calls.length === 0) {
    throw new Error('No calls to execute.')
  }
  const vaultNorm = getAddress(vaultAddress)
  let lastHash = ''
  let i = 0
  while (i < calls.length) {
    const to = getAddress(calls[i]!.to)
    if (to !== vaultNorm) {
      const tx = await signer.sendTransaction({ to, data: calls[i]!.data })
      const receipt = await tx.wait()
      lastHash = receipt?.hash ?? tx.hash
      i += 1
      continue
    }
    const vaultChunk: `0x${string}`[] = []
    while (i < calls.length && getAddress(calls[i]!.to) === vaultNorm) {
      vaultChunk.push(calls[i]!.data)
      i += 1
    }
    lastHash = await executeVaultCallsFromSigner(signer, vaultAddress, vaultChunk)
  }
  return lastHash
}

/**
 * Like {@link executeVaultCallsFromSigner} but fires `eth_sendTransaction` without waiting for a receipt.
 * Suitable when the connected wallet is a Safe (WalletConnect from Safe{Wallet}, Safe Apps iframe): the
 * returned hash is a synthetic Safe proposal id, not a real on-chain tx hash, so `tx.wait()` would hang.
 */
export async function sendVaultCallsFromSigner(
  signer: Signer,
  vaultAddress: string,
  callDatas: `0x${string}`[]
): Promise<void> {
  const to = getAddress(vaultAddress)
  if (callDatas.length === 0) {
    throw new Error('No vault calls to execute.')
  }
  if (callDatas.length === 1) {
    await signer.sendTransaction({ to, data: callDatas[0] })
    return
  }
  const data = vaultIface.encodeFunctionData('multicall', [callDatas]) as `0x${string}`
  await signer.sendTransaction({ to, data })
}

/**
 * Like {@link executeTargetedBatchFromSigner} but does not await receipts. Contiguous vault calls are still
 * packed into `multicall`; non-vault calls become one proposal each in the Safe queue.
 */
export async function sendTargetedBatchFromSigner(
  signer: Signer,
  vaultAddress: string,
  calls: TargetedCall[]
): Promise<void> {
  if (calls.length === 0) {
    throw new Error('No calls to execute.')
  }
  const vaultNorm = getAddress(vaultAddress)
  let i = 0
  while (i < calls.length) {
    const to = getAddress(calls[i]!.to)
    if (to !== vaultNorm) {
      await signer.sendTransaction({ to, data: calls[i]!.data })
      i += 1
      continue
    }
    const vaultChunk: `0x${string}`[] = []
    while (i < calls.length && getAddress(calls[i]!.to) === vaultNorm) {
      vaultChunk.push(calls[i]!.data)
      i += 1
    }
    await sendVaultCallsFromSigner(signer, vaultAddress, vaultChunk)
  }
}
