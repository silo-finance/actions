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

export type ResolvedSiloInput =
  | {
      kind: 'silo'
      siloConfig: string
      silos: [string]
    }
  | {
      kind: 'silo_config'
      siloConfig: string
      silos: [string, string]
    }

type MulticallEntry = { success: boolean; returnData: `0x${string}` }

/**
 * One multicall determines whether `address` is a Silo or a SiloConfig:
 *  - `Silo.config()` returns the SiloConfig (non-zero when `address` is a silo).
 *  - `SiloConfig.getSilos()` returns `(silo0, silo1)` (non-zero when `address` is a SiloConfig).
 *
 * The first call that cleanly decodes to non-zero address(es) wins. Neither call existing =>
 * throw a friendly "neither Silo nor SiloConfig" error.
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
    return { kind: 'silo', siloConfig: siloConfigFromSilo, silos: [target] }
  }

  const pair = decodeSiloPair(getSilosReturn)
  if (pair && pair[0] !== ZeroAddress && pair[1] !== ZeroAddress) {
    return { kind: 'silo_config', siloConfig: target, silos: pair }
  }

  throw new Error(
    'Address is neither a Silo nor a SiloConfig on this network. Double-check the address and the selected chain.'
  )
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
