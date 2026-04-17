import { Contract, type Provider, getAddress } from 'ethers'
import erc20Artifact from '@/abis/ERC20.json'
import siloVaultArtifact from '@/abis/SiloVault.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall } from '@/utils/readMulticall'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const erc20Abi = loadAbi(erc20Artifact)

export type VaultUnderlyingMeta = {
  /** ERC-20 from `vault.asset()` (checksummed). */
  address: string
  decimals: number
  symbol: string
}

/**
 * Human-readable whole tokens only: `raw / 10^decimals` with integer division (no fractional part).
 * Appends `meta.symbol` when set. If `meta` is missing, returns `raw` as a decimal string.
 */
function pow10BigInt(exp: number): bigint {
  let p = BigInt(1)
  for (let i = 0; i < exp; i++) p *= BigInt(10)
  return p
}

export function formatVaultAmountWholeTokens(raw: bigint, meta: VaultUnderlyingMeta | null): string {
  if (!meta) return raw.toString()
  const d = meta.decimals
  if (!Number.isFinite(d) || d < 0 || d > 255) return raw.toString()
  try {
    const whole = raw / pow10BigInt(d)
    const sym = meta.symbol.trim()
    return sym.length > 0 ? `${whole.toString()} ${sym}` : whole.toString()
  } catch {
    return raw.toString()
  }
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
    const assetNorm = getAddress(assetAddr)
    const token = new Contract(assetNorm, erc20Abi, provider)
    const [dec, sym] = await Promise.all([token.decimals(), token.symbol()])
    return { address: assetNorm, decimals: Number(dec), symbol: String(sym) }
  } catch {
    return null
  }
}

async function readQueues(
  provider: Provider,
  vaultAddress: string,
  sLen: number,
  wLen: number
): Promise<{ supply: string[]; withdraw: string[] }> {
  const vaultNorm = getAddress(vaultAddress)
  const vault = new Contract(vaultNorm, siloVaultAbi, provider)
  const calls = [
    ...Array.from({ length: sLen }, (_, i) =>
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'supplyQueue',
        args: [i],
        fallback: async () => vault.supplyQueue(i),
        decodeResult: (value) => String(value),
      })
    ),
    ...Array.from({ length: wLen }, (_, i) =>
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'withdrawQueue',
        args: [i],
        fallback: async () => vault.withdrawQueue(i),
        decodeResult: (value) => String(value),
      })
    ),
  ]
  const result = await executeReadMulticall(provider, calls, {
    debugLabel: 'vaultReader:readQueues',
  })
  const supply = result.slice(0, sLen).map((a) => String(a))
  const withdraw = result.slice(sLen, sLen + wLen).map((a) => String(a))
  return { supply, withdraw }
}

export async function fetchVaultQueues(provider: Provider, vaultAddress: string): Promise<{
  supply: string[]
  withdraw: string[]
}> {
  const vaultNorm = getAddress(vaultAddress)
  const vault = new Contract(vaultNorm, siloVaultAbi, provider)
  const [supplyLen, withdrawLen] = await executeReadMulticall(provider, [
    buildReadMulticallCall({
      target: vaultNorm,
      abi: siloVaultAbi,
      functionName: 'supplyQueueLength',
      fallback: async () => vault.supplyQueueLength(),
      decodeResult: (value) => Number(value),
    }),
    buildReadMulticallCall({
      target: vaultNorm,
      abi: siloVaultAbi,
      functionName: 'withdrawQueueLength',
      fallback: async () => vault.withdrawQueueLength(),
      decodeResult: (value) => Number(value),
    }),
  ])
  return readQueues(provider, vaultNorm, Number(supplyLen), Number(withdrawLen))
}

export type VaultOverview = {
  supply: string[]
  withdraw: string[]
  owner: string
  curator: string
  guardian: string
  timelockSeconds: bigint
}

/** Owner, timelock, curator, guardian, and both queues in one flow (single vault Contract instance). */
export async function fetchVaultOverview(provider: Provider, vaultAddress: string): Promise<VaultOverview> {
  const vaultNorm = getAddress(vaultAddress)
  const vault = new Contract(vaultNorm, siloVaultAbi, provider)
  const [owner, timelock, supplyLen, withdrawLen, curator, guardian] = await executeReadMulticall(
    provider,
    [
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'owner',
        fallback: async () => vault.owner(),
      }),
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'timelock',
        fallback: async () => vault.timelock(),
      }),
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'supplyQueueLength',
        fallback: async () => vault.supplyQueueLength(),
        decodeResult: (value) => Number(value),
      }),
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'withdrawQueueLength',
        fallback: async () => vault.withdrawQueueLength(),
        decodeResult: (value) => Number(value),
      }),
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'curator',
        fallback: async () => vault.curator(),
      }),
      buildReadMulticallCall({
        target: vaultNorm,
        abi: siloVaultAbi,
        functionName: 'guardian',
        fallback: async () => vault.guardian(),
      }),
    ],
    {
      debugLabel: 'vaultReader:overviewHead',
    }
  )
  const sLen = Number(supplyLen)
  const wLen = Number(withdrawLen)
  const { supply, withdraw } = await readQueues(provider, vaultNorm, sLen, wLen)
  return {
    supply,
    withdraw,
    owner: String(owner),
    curator: String(curator),
    guardian: String(guardian),
    timelockSeconds: BigInt(timelock),
  }
}
