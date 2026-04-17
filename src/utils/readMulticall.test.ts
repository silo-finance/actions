import { Interface, getAddress, type Provider } from 'ethers'
import { describe, expect, it, vi } from 'vitest'
import { buildReadMulticallCall, executeReadMulticall } from '@/utils/readMulticall'

const multicallIface = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
])

const uintAbi = ['function readValue() view returns (uint256)'] as const
const uintIface = new Interface(uintAbi)

function mockProvider(params: {
  chainId?: number
  callImpl: (tx: { to: string; data: string }) => Promise<string>
}): Provider {
  const chainId = params.chainId ?? 1
  return {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    call: params.callImpl,
  } as unknown as Provider
}

describe('executeReadMulticall', () => {
  it('decodes successful aggregate3 responses', async () => {
    const fallbackA = vi.fn(async () => BigInt(0))
    const fallbackB = vi.fn(async () => BigInt(0))
    const provider = mockProvider({
      callImpl: async ({ data }) => {
        const decodedCalls = multicallIface.decodeFunctionData('aggregate3', data)[0] as Array<{
          target: string
          allowFailure: boolean
          callData: string
        }>
        const encodedResults = decodedCalls.map((_, i) => ({
          success: true,
          returnData: uintIface.encodeFunctionResult('readValue', [BigInt(i + 1)]),
        }))
        return multicallIface.encodeFunctionResult('aggregate3', [encodedResults])
      },
    })

    const [a, b] = await executeReadMulticall(provider, [
      buildReadMulticallCall({
        target: getAddress('0x1111111111111111111111111111111111111111'),
        abi: uintAbi,
        functionName: 'readValue',
        fallback: fallbackA,
        decodeResult: (v) => BigInt(String(v)),
      }),
      buildReadMulticallCall({
        target: getAddress('0x2222222222222222222222222222222222222222'),
        abi: uintAbi,
        functionName: 'readValue',
        fallback: fallbackB,
        decodeResult: (v) => BigInt(String(v)),
      }),
    ])

    expect(a).toBe(BigInt(1))
    expect(b).toBe(BigInt(2))
    expect(fallbackA).not.toHaveBeenCalled()
    expect(fallbackB).not.toHaveBeenCalled()
  })

  it('returns null for allowFailure=true when a call fails', async () => {
    const provider = mockProvider({
      callImpl: async () => {
        const encodedResults = [{ success: false, returnData: '0x' }]
        return multicallIface.encodeFunctionResult('aggregate3', [encodedResults])
      },
    })
    const [value] = await executeReadMulticall(provider, [
      buildReadMulticallCall({
        target: getAddress('0x3333333333333333333333333333333333333333'),
        abi: uintAbi,
        functionName: 'readValue',
        allowFailure: true,
        fallback: async () => BigInt(7),
        decodeResult: (v) => BigInt(String(v)),
      }),
    ])
    expect(value).toBeNull()
  })

  it('falls back to direct calls when aggregate3 rpc fails', async () => {
    const fallbackA = vi.fn(async () => BigInt(11))
    const fallbackB = vi.fn(async () => BigInt(22))
    const provider = mockProvider({
      callImpl: async () => {
        throw new Error('rpc rate limited')
      },
    })
    const results = await executeReadMulticall(provider, [
      buildReadMulticallCall({
        target: getAddress('0x4444444444444444444444444444444444444444'),
        abi: uintAbi,
        functionName: 'readValue',
        fallback: fallbackA,
        decodeResult: (v) => BigInt(String(v)),
      }),
      buildReadMulticallCall({
        target: getAddress('0x5555555555555555555555555555555555555555'),
        abi: uintAbi,
        functionName: 'readValue',
        fallback: fallbackB,
        decodeResult: (v) => BigInt(String(v)),
      }),
    ])
    expect(results).toEqual([BigInt(11), BigInt(22)])
    expect(fallbackA).toHaveBeenCalledTimes(1)
    expect(fallbackB).toHaveBeenCalledTimes(1)
  })

  it('splits calls into chunks when chunkSize is set', async () => {
    const rpcCalls: string[] = []
    const provider = mockProvider({
      callImpl: async ({ data }) => {
        rpcCalls.push(data)
        const decodedCalls = multicallIface.decodeFunctionData('aggregate3', data)[0] as Array<{
          target: string
          allowFailure: boolean
          callData: string
        }>
        const encodedResults = decodedCalls.map(() => ({
          success: true,
          returnData: uintIface.encodeFunctionResult('readValue', [BigInt(1)]),
        }))
        return multicallIface.encodeFunctionResult('aggregate3', [encodedResults])
      },
    })
    const callA = buildReadMulticallCall({
      target: getAddress('0x6666666666666666666666666666666666666666'),
      abi: uintAbi,
      functionName: 'readValue',
      fallback: async () => BigInt(1),
      decodeResult: (v) => BigInt(String(v)),
    })
    const callB = buildReadMulticallCall({
      target: getAddress('0x7777777777777777777777777777777777777777'),
      abi: uintAbi,
      functionName: 'readValue',
      fallback: async () => BigInt(1),
      decodeResult: (v) => BigInt(String(v)),
    })
    await executeReadMulticall(provider, [callA, callB], { chunkSize: 1 })
    expect(rpcCalls.length).toBe(2)
  })
})
