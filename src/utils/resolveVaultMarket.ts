import { Contract, type Provider, ZeroAddress, getAddress } from 'ethers'
import idleVaultArtifact from '@/abis/IdleVault.json'
import siloArtifact from '@/abis/Silo.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import erc20Artifact from '@/abis/ERC20.json'
import { loadAbi } from '@/utils/loadAbi'
import type { VaultUnderlyingMeta } from '@/utils/vaultReader'

const idleVaultAbi = loadAbi(idleVaultArtifact)
const siloAbi = loadAbi(siloArtifact)
const siloConfigAbi = loadAbi(siloConfigArtifact)
const erc20Abi = loadAbi(erc20Artifact)

export type ResolvedMarket = {
  address: string
  label: string
  kind: 'IdleVault' | 'Silo' | 'Unknown'
  /** Vault principal in this market, e.g. `1.234 USDC` (same decimals/symbol as `vault.asset()`). */
  positionLabel?: string
  /** From `SiloConfig.SILO_ID()` when this market is a Silo vault. */
  siloConfigId?: bigint
  /** Supply cap as whole vault-underlying tokens, set when queues are loaded with `resolveMarketsForQueues`. */
  capLabel?: string
}

async function readSymbol(provider: Provider, tokenAddress: string): Promise<string | undefined> {
  if (!tokenAddress || tokenAddress === ZeroAddress) return undefined
  try {
    const t = new Contract(tokenAddress, erc20Abi, provider)
    const sym = await t.symbol()
    return typeof sym === 'string' ? sym : String(sym)
  } catch {
    return undefined
  }
}

export async function resolveMarketLabel(
  provider: Provider,
  marketAddress: string,
  vaultAddress: string,
  cache: Map<string, ResolvedMarket>,
  /** When set, Silo pair labels use only the non-vault asset symbol (one fewer `symbol()` RPC per Silo). */
  vaultUnderlying: VaultUnderlyingMeta | null
): Promise<ResolvedMarket> {
  const key = marketAddress.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  let vaultNorm: string
  try {
    vaultNorm = getAddress(vaultAddress)
  } catch {
    const fallback: ResolvedMarket = { address: marketAddress, label: 'Unknown market', kind: 'Unknown' }
    cache.set(key, fallback)
    return fallback
  }

  let marketNorm: string
  try {
    marketNorm = getAddress(marketAddress)
  } catch {
    const fallback: ResolvedMarket = { address: marketAddress, label: 'Unknown market', kind: 'Unknown' }
    cache.set(key, fallback)
    return fallback
  }

  try {
    const idle = new Contract(marketNorm, idleVaultAbi, provider)
    const depositor: string = await idle.ONLY_DEPOSITOR()
    const dep = typeof depositor === 'string' ? getAddress(depositor) : getAddress(String(depositor))
    if (dep === vaultNorm) {
      const res: ResolvedMarket = { address: marketNorm, label: 'IdleVault', kind: 'IdleVault' }
      cache.set(key, res)
      return res
    }
  } catch {
    // not IdleVault or call failed
  }

  try {
    const silo = new Contract(marketNorm, siloAbi, provider)
    const configAddr: string = await silo.config()
    if (!configAddr || configAddr === ZeroAddress) throw new Error('no config')
    const cfg = new Contract(configAddr, siloConfigAbi, provider)
    const silos = await cfg.getSilos()
    const s0 = String(silos[0])
    const s1 = String(silos[1])
    const silo0 = new Contract(s0, siloAbi, provider)
    const silo1 = new Contract(s1, siloAbi, provider)
    const [a0, a1] = await Promise.all([silo0.asset(), silo1.asset()])
    const asset0 = String(a0)
    const asset1 = String(a1)

    let label: string
    const vaultAsset = vaultUnderlying?.address
    if (vaultAsset) {
      try {
        const vA = getAddress(vaultAsset)
        const t0 = getAddress(asset0)
        const t1 = getAddress(asset1)
        if (t0 === vA) {
          const sym = await readSymbol(provider, asset1)
          label = sym ?? '?'
        } else if (t1 === vA) {
          const sym = await readSymbol(provider, asset0)
          label = sym ?? '?'
        } else {
          const [sym0, sym1] = await Promise.all([readSymbol(provider, asset0), readSymbol(provider, asset1)])
          label =
            sym0 && sym1 ? `${sym0}/${sym1}` : sym0 || sym1 ? `${sym0 ?? '?'}/${sym1 ?? '?'}` : 'Unknown market'
        }
      } catch {
        const [sym0, sym1] = await Promise.all([readSymbol(provider, asset0), readSymbol(provider, asset1)])
        label =
          sym0 && sym1 ? `${sym0}/${sym1}` : sym0 || sym1 ? `${sym0 ?? '?'}/${sym1 ?? '?'}` : 'Unknown market'
      }
    } else {
      const [sym0, sym1] = await Promise.all([readSymbol(provider, asset0), readSymbol(provider, asset1)])
      label =
        sym0 && sym1 ? `${sym0}/${sym1}` : sym0 || sym1 ? `${sym0 ?? '?'}/${sym1 ?? '?'}` : 'Unknown market'
    }
    let siloConfigId: bigint | undefined
    try {
      const idRaw = await cfg.SILO_ID()
      siloConfigId = BigInt(idRaw.toString())
    } catch {
      siloConfigId = undefined
    }
    const res: ResolvedMarket = { address: marketNorm, label, kind: 'Silo', siloConfigId }
    cache.set(key, res)
    return res
  } catch {
    const res: ResolvedMarket = { address: marketNorm, label: 'Unknown market', kind: 'Unknown' }
    cache.set(key, res)
    return res
  }
}
