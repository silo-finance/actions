import { Interface, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import { extractErrorMessage } from '@/utils/rpcErrors'

const vaultIface = new Interface(loadAbi(siloVaultArtifact))
const errorStringIface = new Interface(['error Error(string message)'])

function collectErrors(err: unknown, depth = 0): unknown[] {
  if (err == null || depth > 5 || typeof err !== 'object') return err == null ? [] : [err]
  const e = err as Record<string, unknown>
  const nested = ['cause', 'error', 'info'].flatMap((key) => collectErrors(e[key], depth + 1))
  return [err, ...nested]
}

function revertData(err: unknown): string | null {
  if (err == null || typeof err !== 'object') return null
  const e = err as { data?: unknown }
  const data = e.data
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) return data
  if (data != null && typeof data === 'object' && 'data' in data) {
    const inner = (data as { data?: unknown }).data
    if (typeof inner === 'string' && inner.startsWith('0x') && inner.length >= 10) return inner
  }
  return null
}

function formatParsedError(name: string, args: readonly unknown[] | undefined): string {
  if (name === 'Error' && args?.length === 1) return String(args[0])
  if (args == null || args.length === 0) return name
  return `${name}(${Array.from(args, (value) => String(value)).join(', ')})`
}

function parseRevertData(data: string): string | null {
  for (const iface of [vaultIface, errorStringIface]) {
    try {
      const parsed = iface.parseError(data)
      if (parsed) return formatParsedError(parsed.name, parsed.args)
    } catch {
      // Selector belongs to another ABI.
    }
  }
  return null
}

/** Custom error from a failed vault `eth_call`, such as `NotAllocatorRole`. */
export function describeVaultRevert(err: unknown): string | null {
  for (const candidate of collectErrors(err)) {
    if (candidate != null && typeof candidate === 'object' && 'revert' in candidate) {
      const revert = (candidate as { revert?: { name?: string; args?: readonly unknown[] } }).revert
      if (revert?.name) return formatParsedError(revert.name, revert.args)
    }
    const data = revertData(candidate)
    if (data) {
      const parsed = parseRevertData(data)
      if (parsed) return parsed
    }
  }
  const reverted = extractErrorMessage(err).match(/execution reverted:\s*(.+)/i)
  const reason = reverted?.[1]?.trim()
  return reason ? reason : null
}

/**
 * Runs the vault call as the signer. A revert is rethrown as the decoded custom error so the UI
 * can show the chain reason. A successful call returns without sending a transaction.
 */
export async function assertVaultCallSucceeds(signer: Signer, to: string, data: string): Promise<void> {
  const provider = signer.provider
  if (provider == null) return
  const from = await signer.getAddress()
  try {
    await provider.call({ from, to, data })
  } catch (e) {
    const decoded = describeVaultRevert(e)
    if (decoded) throw new Error(decoded)
    throw e
  }
}
