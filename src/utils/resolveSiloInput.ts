import { Interface, getAddress, ZeroAddress, type Provider } from 'ethers'
import siloArtifact from '@/abis/Silo.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import { loadAbi } from '@/utils/loadAbi'
import { getMulticall3Config } from '@/config/multicall'

const siloAbi = loadAbi(siloArtifact)
const siloConfigAbi = loadAbi(siloConfigArtifact)

const siloIface = new Interface(siloAbi)
const siloConfigIface = new Interface(siloConfigAbi)

const multicall3Abi = [
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
] as const
const multicall3Iface = new Interface(multicall3Abi)

/**
 * Unified shape — whether the user entered a `Silo` or a `SiloConfig` address, downstream code
 * always receives the parent `SiloConfig` plus both silos. A silo input just triggers one extra
 * read (parent's `getSilos()`) so the UI can lift both `Silo0` / `Silo1` immediately.
 */
export type ResolvedSiloInput = {
  siloConfig: string
  silos: [string, string]
}

type MulticallEntry = { success: boolean; returnData: `0x${string}` }

/**
 * Two-phase resolve, kept as cheap as possible:
 *
 *  1. A single multicall on `address` tries both `Silo.config()` and `SiloConfig.getSilos()`.
 *  2. If the input looked like a `Silo` (non-zero `config()` return), a second multicall on that
 *     parent `SiloConfig` fetches `getSilos()` so we always return the pair.
 *
 * Neither branch resolving => "neither Silo nor SiloConfig" error.
 */
export async function resolveSiloInput(
  provider: Provider,
  address: string
): Promise<ResolvedSiloInput> {
  const target = getAddress(address)
  const configCallData = siloIface.encodeFunctionData('config', []) as `0x${string}`
  const getSilosCallData = siloConfigIface.encodeFunctionData('getSilos', []) as `0x${string}`

  const net = await provider.getNetwork()
  const chainId = Number(net.chainId)
  const multicall = getMulticall3Config(chainId)

  let configReturn: `0x${string}` | null = null
  let getSilosReturn: `0x${string}` | null = null

  if (multicall) {
    const payload = [
      { target, allowFailure: true, callData: configCallData },
      { target, allowFailure: true, callData: getSilosCallData },
    ]
    const encoded = multicall3Iface.encodeFunctionData('aggregate3', [payload]) as `0x${string}`
    try {
      const raw = (await provider.call({ to: multicall.address, data: encoded })) as `0x${string}`
      const decoded = multicall3Iface.decodeFunctionResult('aggregate3', raw)[0] as MulticallEntry[]
      configReturn = decoded[0]?.success ? decoded[0].returnData : null
      getSilosReturn = decoded[1]?.success ? decoded[1].returnData : null
    } catch {
      configReturn = null
      getSilosReturn = null
    }
  }

  if (!multicall) {
    configReturn = await safeEthCall(provider, target, configCallData)
    getSilosReturn = await safeEthCall(provider, target, getSilosCallData)
  }

  const siloConfigFromSilo = decodeAddress(siloIface, 'config', configReturn)
  if (siloConfigFromSilo && siloConfigFromSilo !== ZeroAddress) {
    const pair = await fetchSiloPair(provider, siloConfigFromSilo, multicall)
    if (pair && pair[0] !== ZeroAddress && pair[1] !== ZeroAddress) {
      return { siloConfig: siloConfigFromSilo, silos: pair }
    }
    throw new Error(
      'Silo resolved to a SiloConfig, but getSilos() did not return a valid pair. The market may be misconfigured.'
    )
  }

  const pair = decodeSiloPair(getSilosReturn)
  if (pair && pair[0] !== ZeroAddress && pair[1] !== ZeroAddress) {
    return { siloConfig: target, silos: pair }
  }

  throw new Error(
    'Address is neither a Silo nor a SiloConfig on this network. Double-check the address and the selected chain.'
  )
}

/**
 * Fetches `getSilos()` on the parent `SiloConfig`. Uses multicall when available for parity with
 * the first-phase call (keeps the RPC call shape uniform), falling back to a plain `eth_call`.
 */
async function fetchSiloPair(
  provider: Provider,
  siloConfig: string,
  multicall: ReturnType<typeof getMulticall3Config>
): Promise<[string, string] | null> {
  const callData = siloConfigIface.encodeFunctionData('getSilos', []) as `0x${string}`
  let returnData: `0x${string}` | null = null
  if (multicall) {
    const payload = [{ target: siloConfig, allowFailure: true, callData }]
    const encoded = multicall3Iface.encodeFunctionData('aggregate3', [payload]) as `0x${string}`
    try {
      const raw = (await provider.call({ to: multicall.address, data: encoded })) as `0x${string}`
      const decoded = multicall3Iface.decodeFunctionResult('aggregate3', raw)[0] as MulticallEntry[]
      returnData = decoded[0]?.success ? decoded[0].returnData : null
    } catch {
      returnData = null
    }
  } else {
    returnData = await safeEthCall(provider, siloConfig, callData)
  }
  return decodeSiloPair(returnData)
}

async function safeEthCall(
  provider: Provider,
  to: string,
  data: `0x${string}`
): Promise<`0x${string}` | null> {
  try {
    return (await provider.call({ to, data })) as `0x${string}`
  } catch {
    return null
  }
}

function decodeAddress(iface: Interface, functionName: string, returnData: `0x${string}` | null): string | null {
  if (!returnData || returnData === '0x') return null
  try {
    const fn = iface.getFunction(functionName)
    if (!fn) return null
    const decoded = iface.decodeFunctionResult(fn, returnData)
    const value = decoded.length === 1 ? decoded[0] : decoded[0]
    return typeof value === 'string' ? getAddress(value) : null
  } catch {
    return null
  }
}

function decodeSiloPair(returnData: `0x${string}` | null): [string, string] | null {
  if (!returnData || returnData === '0x') return null
  try {
    const fn = siloConfigIface.getFunction('getSilos')
    if (!fn) return null
    const decoded = siloConfigIface.decodeFunctionResult(fn, returnData)
    const silo0 = decoded[0]
    const silo1 = decoded[1]
    if (typeof silo0 !== 'string' || typeof silo1 !== 'string') return null
    return [getAddress(silo0), getAddress(silo1)]
  } catch {
    return null
  }
}
