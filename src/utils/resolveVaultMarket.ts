import { Contract, type Provider, ZeroAddress, getAddress } from 'ethers'
import idleVaultArtifact from '@/abis/IdleVault.json'
import siloArtifact from '@/abis/Silo.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import erc20Artifact from '@/abis/ERC20.json'
import { loadAbi } from '@/utils/loadAbi'

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
  cache: Map<string, ResolvedMarket>
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
    const [sym0, sym1] = await Promise.all([readSymbol(provider, asset0), readSymbol(provider, asset1)])
    const label =
      sym0 && sym1 ? `${sym0}/${sym1}` : sym0 || sym1 ? `${sym0 ?? '?'}/${sym1 ?? '?'}` : 'Unknown market'
    const res: ResolvedMarket = { address: marketNorm, label, kind: 'Silo' }
    cache.set(key, res)
    return res
  } catch {
    const res: ResolvedMarket = { address: marketNorm, label: 'Unknown market', kind: 'Unknown' }
    cache.set(key, res)
    return res
  }
}
