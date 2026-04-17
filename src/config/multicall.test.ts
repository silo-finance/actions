import { describe, expect, it } from 'vitest'
import { MULTICALL3_BY_CHAIN_ID } from '@/config/multicall'
import { NETWORK_CONFIGS } from '@/utils/networks'

describe('MULTICALL3_BY_CHAIN_ID', () => {
  it('has a multicall3 address for every supported chain', () => {
    for (const net of NETWORK_CONFIGS) {
      const cfg = MULTICALL3_BY_CHAIN_ID[net.chainId]
      expect(cfg, `Missing multicall3 config for chain ${net.chainId} (${net.chainName})`).toBeDefined()
      expect(cfg.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })
})
