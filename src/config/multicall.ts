export type Multicall3Config = {
  address: `0x${string}`
  blockCreated?: number
}

export const MULTICALL3_BY_CHAIN_ID: Record<number, Multicall3Config> = {
  1: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 14353601,
  },
  10: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 4286263,
  },
  50: {
    address: '0x0B1795ccA8E4eC4df02346a082df54D437F8D9aF',
    blockCreated: 75884020,
  },
  56: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 15921452,
  },
  146: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 60,
  },
  196: {
    address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    blockCreated: 47416,
  },
  1776: {
    address: '0xcA11bde05977b3631167028862bE2a173976CA11',
  },
  4326: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
  },
  5000: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
  },
  42161: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 7654707,
  },
  43114: {
    address: '0xca11bde05977b3631167028862be2a173976ca11',
    blockCreated: 11907934,
  },
}

export function getMulticall3Config(chainId: number): Multicall3Config | null {
  return MULTICALL3_BY_CHAIN_ID[chainId] ?? null
}
