import { Contract, type Provider, getAddress } from 'ethers'
import erc20Artifact from '@/abis/ERC20.json'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const erc20Abi = loadAbi(erc20Artifact)

export type VaultUnderlyingMeta = {
  decimals: number
  symbol: string
}

/** `vault.asset()` ERC-20 decimals + symbol — one underlying asset for the whole vault UI. */
export async function fetchVaultUnderlyingMeta(
  provider: Provider,
  vaultAddress: string
): Promise<VaultUnderlyingMeta | null> {
  try {
    const vaultNorm = getAddress(vaultAddress)
    const vault = new Contract(vaultNorm, siloVaultAbi, provider)
    const assetAddr = String(await vault.asset())
    const token = new Contract(assetAddr, erc20Abi, provider)
    const [dec, sym] = await Promise.all([token.decimals(), token.symbol()])
    return { decimals: Number(dec), symbol: String(sym) }
  } catch {
    return null
  }
}

async function readQueues(
  vault: Contract,
  sLen: number,
  wLen: number
): Promise<{ supply: string[]; withdraw: string[] }> {
  const supply = await Promise.all(
    Array.from({ length: sLen }, (_, i) => vault.supplyQueue(i).then((a: string) => String(a)))
  )
  const withdraw = await Promise.all(
    Array.from({ length: wLen }, (_, i) => vault.withdrawQueue(i).then((a: string) => String(a)))
  )
  return { supply, withdraw }
}

export async function fetchVaultQueues(provider: Provider, vaultAddress: string): Promise<{
  supply: string[]
  withdraw: string[]
}> {
  const vault = new Contract(vaultAddress, siloVaultAbi, provider)
  const [supplyLen, withdrawLen] = await Promise.all([
    vault.supplyQueueLength(),
    vault.withdrawQueueLength(),
  ])
  return readQueues(vault, Number(supplyLen), Number(withdrawLen))
}

export type VaultOverview = {
  supply: string[]
  withdraw: string[]
  owner: string
  timelockSeconds: bigint
}

/** Owner, timelock, and both queues in one flow (single vault Contract instance). */
export async function fetchVaultOverview(provider: Provider, vaultAddress: string): Promise<VaultOverview> {
  const vault = new Contract(vaultAddress, siloVaultAbi, provider)
  const [owner, timelock, supplyLen, withdrawLen] = await Promise.all([
    vault.owner(),
    vault.timelock(),
    vault.supplyQueueLength(),
    vault.withdrawQueueLength(),
  ])
  const sLen = Number(supplyLen)
  const wLen = Number(withdrawLen)
  const { supply, withdraw } = await readQueues(vault, sLen, wLen)
  return {
    supply,
    withdraw,
    owner: String(owner),
    timelockSeconds: BigInt(timelock),
  }
}
