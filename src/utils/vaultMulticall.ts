import { getAddress, Interface, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))

type Eip1193LikeProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>
}

/** One on-chain call in a batch (same or different `to` contracts). */
export type TargetedCall = {
  to: string
  data: `0x${string}`
}

function isMethodNotSupportedError(e: unknown): boolean {
  const err = e as { code?: number; message?: string; data?: { code?: number } } | undefined
  if (!err) return false
  if (err.code === 4200 || err.code === -32601 || err.code === -32602) return true
  if (err.data?.code === 4200 || err.data?.code === -32601) return true
  const msg = (err.message ?? '').toLowerCase()
  return (
    msg.includes('does not support') ||
    msg.includes('not supported') ||
    msg.includes('method not found') ||
    msg.includes('unsupported method') ||
    msg.includes('unrecognized method') ||
    msg.includes('unknown method') ||
    msg.includes('unsupported request')
  )
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
 * Submits a batch when the connected wallet IS the Safe (WalletConnect from Safe{Wallet} / Safe Apps
 * iframe / Rabby impersonate): produces ONE Safe proposal whenever possible, with every action
 * surfaced as an individually-decoded MultiSend entry in the Safe UI.
 *
 * Intentionally does NOT wrap vault calls in `vault.multicall(bytes[])` — Safe's transaction review
 * decodes each entry against its target's ABI, and a `multicall(bytes[])` envelope shows up as an
 * opaque bytes blob. Passing the raw per-method calldata (e.g. `reallocate(...)`, `submitCap(...)`,
 * `updateWithdrawQueue(...)`, `setSupplyQueue(...)`) keeps the sequence legible to co-signers.
 *
 * Strategy:
 * 1. If exactly one call, use `eth_sendTransaction` — Safe queues a single proposal.
 * 2. Otherwise submit all calls via EIP-5792 `wallet_sendCalls`. Safe Apps SDK + Safe{Wallet} map
 *    this to a single `sdk.txs.send({ txs })` MultiSend proposal where every entry is visible.
 * 3. If the wallet does not implement EIP-5792, fall back to sequential `eth_sendTransaction`
 *    (one Safe proposal per call) and log a warning.
 *
 * No receipts are awaited — the hash returned by Safe-backed wallets is a synthetic proposal id.
 */
export async function sendSafeWalletBatch(params: {
  ethereum: Eip1193LikeProvider
  signer: Signer
  chainId: number
  from: string
  calls: TargetedCall[]
}): Promise<void> {
  if (params.calls.length === 0) {
    throw new Error('No calls to execute.')
  }
  const from = getAddress(params.from)
  const normalized = params.calls.map((c) => ({ to: getAddress(c.to), data: c.data }))

  if (normalized.length === 1) {
    const c = normalized[0]!
    await params.signer.sendTransaction({ to: c.to, data: c.data })
    return
  }

  const chainIdHex = `0x${params.chainId.toString(16)}`
  const encodedCalls = normalized.map((c) => ({ to: c.to, data: c.data, value: '0x0' }))

  try {
    await params.ethereum.request({
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          from,
          chainId: chainIdHex,
          atomicRequired: true,
          calls: encodedCalls,
        },
      ],
    })
    return
  } catch (e) {
    if (!isMethodNotSupportedError(e)) throw e
  }

  /**
   * Legacy EIP-5792 draft (v1) — some Safe Apps providers and Rabby builds accept the no-version,
   * no-atomicRequired form. Try once before giving up.
   */
  try {
    await params.ethereum.request({
      method: 'wallet_sendCalls',
      params: [
        {
          from,
          chainId: chainIdHex,
          calls: encodedCalls,
        },
      ],
    })
    return
  } catch (e) {
    if (!isMethodNotSupportedError(e)) throw e
  }

  /**
   * Last-resort fallback: sequential `eth_sendTransaction`. Each call becomes its own Safe proposal
   * (bad UX) but it at least does not silently fail. Users on Safe{Wallet} v2 or Safe Apps will hit
   * the EIP-5792 path above and never reach this branch.
   */
  console.warn(
    '[Silo Actions] Connected wallet does not implement EIP-5792 wallet_sendCalls. Falling back to sequential eth_sendTransaction; expect one Safe proposal per call.'
  )
  for (const c of normalized) {
    await params.signer.sendTransaction({ to: c.to, data: c.data })
  }
}
