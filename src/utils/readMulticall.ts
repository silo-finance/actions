import { Interface, getAddress, type InterfaceAbi, type Provider } from 'ethers'
import { getMulticall3Config } from '@/config/multicall'

const multicall3Abi = [
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
] as const

const multicall3Iface = new Interface(multicall3Abi)
const chainIdCache = new WeakMap<object, number>()

type Decoder<T> = (returnData: `0x${string}`) => T
type Fallback<T> = () => Promise<T>

export type ReadMulticallCall<T> = {
  target: string
  allowFailure?: boolean
  callData: `0x${string}`
  decode: Decoder<T>
  fallback: Fallback<T>
}

export type BuildReadMulticallCallParams<T> = {
  target: string
  abi: InterfaceAbi
  functionName: string
  args?: readonly unknown[]
  allowFailure?: boolean
  fallback: Fallback<T>
  decodeResult?: (decoded: unknown) => T
}

export type ExecuteReadMulticallOptions = {
  chainId?: number
  chunkSize?: number
  debugLabel?: string
}

type Aggregate3Result = {
  success: boolean
  returnData: `0x${string}`
}

export function buildReadMulticallCall<T>({
  target,
  abi,
  functionName,
  args = [],
  allowFailure,
  fallback,
  decodeResult,
}: BuildReadMulticallCallParams<T>): ReadMulticallCall<T> {
  const iface = new Interface(abi)
  let fn
  try {
    fn = iface.getFunction(functionName, args as unknown[] | undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `buildReadMulticallCall: could not resolve function "${functionName}". ` +
        `If overloaded, pass full signature (e.g. "foo(uint256)"). Details: ${message}`
    )
  }
  if (!fn) {
    throw new Error(`buildReadMulticallCall: unknown function "${functionName}".`)
  }
  const callData = iface.encodeFunctionData(fn, args) as `0x${string}`
  return {
    target,
    allowFailure,
    callData,
    fallback,
    decode: (returnData: `0x${string}`) => {
      const decoded = iface.decodeFunctionResult(fn, returnData)
      const value = decoded.length === 1 ? decoded[0] : decoded
      return decodeResult ? decodeResult(value) : (value as T)
    },
  }
}

async function resolveChainId(provider: Provider, chainId?: number): Promise<number> {
  if (typeof chainId === 'number' && Number.isFinite(chainId) && chainId > 0) return chainId
  const cached = chainIdCache.get(provider as object)
  if (cached != null) return cached
  const net = await provider.getNetwork()
  const id = Number(net.chainId)
  chainIdCache.set(provider as object, id)
  return id
}

function chunkCalls<T>(calls: ReadMulticallCall<T>[], chunkSize: number): ReadMulticallCall<T>[][] {
  if (calls.length <= chunkSize) return [calls]
  const out: ReadMulticallCall<T>[][] = []
  for (let i = 0; i < calls.length; i += chunkSize) {
    out.push(calls.slice(i, i + chunkSize))
  }
  return out
}

async function runFallback<T>(calls: ReadMulticallCall<T>[], reason: string, debugLabel?: string): Promise<T[]> {
  if (debugLabel) {
    console.debug(`[readMulticall] fallback (${debugLabel}): ${reason}; calls=${calls.length}`)
  }
  return Promise.all(calls.map((c) => c.fallback()))
}

export async function executeReadMulticall<T>(
  provider: Provider,
  calls: ReadMulticallCall<T>[],
  opts: ExecuteReadMulticallOptions = {}
): Promise<(T | null)[]> {
  if (calls.length === 0) return []
  const chainId = await resolveChainId(provider, opts.chainId)
  const multicall = getMulticall3Config(chainId)
  if (!multicall) {
    return runFallback(calls, `no multicall3 configured for chainId=${chainId}`, opts.debugLabel)
  }
  const chunks = chunkCalls(calls, Math.max(1, opts.chunkSize ?? 128))
  const out: (T | null)[] = []
  for (const chunk of chunks) {
    const payload = chunk.map((c) => ({
      target: getAddress(c.target),
      allowFailure: c.allowFailure ?? false,
      callData: c.callData,
    }))
    const encoded = multicall3Iface.encodeFunctionData('aggregate3', [payload]) as `0x${string}`
    let decoded: Aggregate3Result[]
    try {
      const raw = (await provider.call({
        to: multicall.address,
        data: encoded,
      })) as `0x${string}`
      decoded = multicall3Iface.decodeFunctionResult('aggregate3', raw)[0] as Aggregate3Result[]
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const fallback = await runFallback(chunk, reason, opts.debugLabel)
      out.push(...fallback)
      continue
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const call = chunk[i]!
      const res = decoded[i]
      if (!res) {
        throw new Error(`readMulticall: missing response for call index ${i}.`)
      }
      if (!res.success) {
        if (call.allowFailure) {
          out.push(null)
          continue
        }
        throw new Error(`readMulticall: call ${i} reverted and allowFailure=false.`)
      }
      out.push(call.decode(res.returnData))
    }
  }
  if (opts.debugLabel) {
    console.debug(`[readMulticall] success (${opts.debugLabel}): calls=${calls.length}, chunks=${chunks.length}`)
  }
  return out
}
