import { defineChain, type Chain } from 'viem'
import { getMulticall3Config } from '@/config/multicall'
import { NETWORK_CONFIGS } from '@/utils/networks'

/** Viem `Chain` definitions aligned with `NETWORK_CONFIGS` (used by wagmi). */
export const appChains: readonly [Chain, ...Chain[]] = (() => {
  const chains = NETWORK_CONFIGS.map((n) =>
    defineChain({
      id: n.chainId,
      name: n.displayName,
      nativeCurrency: {
        name: n.nativeTokenSymbol,
        symbol: n.nativeTokenSymbol,
        decimals: 18,
      },
      rpcUrls: {
        default: { http: [...n.walletRpcUrls] },
      },
      blockExplorers: {
        default: { name: 'Explorer', url: n.explorerBaseUrl.replace(/\/$/, '') },
      },
      contracts: (() => {
        const multicall3 = getMulticall3Config(n.chainId)
        if (!multicall3) return undefined
        return {
          multicall3: {
            address: multicall3.address,
            ...(multicall3.blockCreated != null ? { blockCreated: multicall3.blockCreated } : {}),
          },
        }
      })(),
    })
  ) as Chain[]
  if (chains.length === 0) throw new Error('appChains: no networks configured')
  return chains as unknown as readonly [Chain, ...Chain[]]
})()
