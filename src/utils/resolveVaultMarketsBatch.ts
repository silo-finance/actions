import { Contract, formatUnits, type Provider, getAddress } from 'ethers'
import idleVaultArtifact from '@/abis/IdleVault.json'
import siloArtifact from '@/abis/Silo.json'
import { loadAbi } from '@/utils/loadAbi'
import { resolveMarketLabel, type ResolvedMarket } from '@/utils/resolveVaultMarket'
import { fetchVaultMarketStates, type WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'
import {
  fetchVaultUnderlyingMeta,
  formatVaultAmountWholeTokens,
  type VaultUnderlyingMeta,
} from '@/utils/vaultReader'

const idleVaultAbi = loadAbi(idleVaultArtifact)
const siloAbi = loadAbi(siloArtifact)

function marketStateLookupKey(addr: string): string {
  try {
    return getAddress(addr).toLowerCase()
  } catch {
    return addr.toLowerCase()
  }
}

function formatWithVaultDecimals(value: bigint, decimals: number): string {
  const raw = formatUnits(value, decimals)
  if (!raw.includes('.')) return raw
  const [intPart, frac = ''] = raw.split('.')
  const fracTrim = frac.replace(/0+$/, '')
  if (fracTrim === '') return intPart
  return `${intPart}.${fracTrim}`
}

async function fetchVaultPositionAssets(
  provider: Provider,
  marketAddress: string,
  vaultAddress: string,
  kind: 'IdleVault' | 'Silo'
): Promise<bigint | null> {
  try {
    const marketNorm = getAddress(marketAddress)
    const vaultNorm = getAddress(vaultAddress)
    const abi = kind === 'IdleVault' ? idleVaultAbi : siloAbi
    const m = new Contract(marketNorm, abi, provider)
    const shares = await m.balanceOf(vaultNorm)
    const preview = m.getFunction('previewRedeem(uint256)')
    const assets = await preview.staticCall(shares)
    return BigInt(assets.toString())
  } catch {
    return null
  }
}

/**
 * Collects unique market addresses (order: first appearance in supply, then withdraw).
 */
export function uniqueMarketAddressesOrdered(supplyAddrs: string[], withdrawAddrs: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const addr of supplyAddrs) {
    const k = addr.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      unique.push(addr)
    }
  }
  for (const addr of withdrawAddrs) {
    const k = addr.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      unique.push(addr)
    }
  }
  return unique
}

/**
 * Resolves metadata once per unique address, then maps back to both queues in original order.
 */
export async function resolveMarketsForQueues(
  provider: Provider,
  vaultAddress: string,
  supplyAddrs: string[],
  withdrawAddrs: string[]
): Promise<{
  supply: ResolvedMarket[]
  withdraw: ResolvedMarket[]
  /** Same order as `withdraw` — subset of one `fetchVaultMarketStates` pass over the supply∪withdraw unique set. */
  withdrawMarketStates: WithdrawMarketOnchainState[]
  underlyingMeta: VaultUnderlyingMeta | null
}> {
  const cache = new Map<string, ResolvedMarket>()
  const unique = uniqueMarketAddressesOrdered(supplyAddrs, withdrawAddrs)

  const [underlying, allMarketStates] = await Promise.all([
    fetchVaultUnderlyingMeta(provider, vaultAddress),
    unique.length === 0
      ? Promise.resolve([] as WithdrawMarketOnchainState[])
      : fetchVaultMarketStates(provider, vaultAddress, unique),
  ])

  const stateByAddress = new Map<string, WithdrawMarketOnchainState>()
  for (const st of allMarketStates) {
    stateByAddress.set(marketStateLookupKey(st.address), st)
  }

  await Promise.all(unique.map((addr) => resolveMarketLabel(provider, addr, vaultAddress, cache, underlying)))

  for (const addr of unique) {
    const r = cache.get(addr.toLowerCase())
    const st = stateByAddress.get(marketStateLookupKey(addr))
    if (r != null && st != null && underlying != null) {
      r.capLabel = formatVaultAmountWholeTokens(st.cap, underlying)
    }
  }

  if (underlying) {
    await Promise.all(
      unique.map(async (addr) => {
        const r = cache.get(addr.toLowerCase())
        if (!r || (r.kind !== 'IdleVault' && r.kind !== 'Silo')) return
        const assets = await fetchVaultPositionAssets(provider, r.address, vaultAddress, r.kind)
        if (assets === null) return
        r.positionLabel = `${formatWithVaultDecimals(assets, underlying.decimals)} ${underlying.symbol}`
      })
    )
  }

  const withdrawMarketStates: WithdrawMarketOnchainState[] = withdrawAddrs.map((addr) => {
    const st = stateByAddress.get(marketStateLookupKey(addr))
    if (st == null) {
      throw new Error('Missing on-chain state for a withdraw-queue market; addresses must match the resolved unique set.')
    }
    return st
  })

  const lookup = (addr: string): ResolvedMarket => {
    const hit = cache.get(addr.toLowerCase())
    if (hit) return hit
    return { address: addr, label: 'Unknown market', kind: 'Unknown' }
  }

  return {
    supply: supplyAddrs.map(lookup),
    withdraw: withdrawAddrs.map(lookup),
    withdrawMarketStates,
    underlyingMeta: underlying,
  }
}
