import { describe, expect, it } from 'vitest'
import {
  GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES,
  filterAddressesWithoutOverride,
  getGlobalPauseContractNameOverride,
} from '@/config/globalPauseContractNameOverrides'
import { NETWORK_CONFIGS } from '@/utils/networks'

const UNKNOWN_ADDRESS = '0x1111111111111111111111111111111111111111'

function firstOverrideEntry(chainId: number): { address: string; name: string } {
  const chainMap = GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES[chainId]
  const entries = Object.entries(chainMap ?? {})
  if (entries.length === 0) throw new Error(`no override entries for chain ${chainId}`)
  const [address, name] = entries[0]
  return { address, name }
}

describe('GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES', () => {
  it('has at least one entry for every supported chain', () => {
    for (const net of NETWORK_CONFIGS) {
      const chainMap = GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES[net.chainId]
      expect(chainMap, `missing chain ${net.chainId}`).toBeDefined()
      expect(Object.keys(chainMap).length, `empty override map for chain ${net.chainId}`).toBeGreaterThan(0)
    }
  })

  it('maps every override address to a non-empty display name', () => {
    for (const [chainId, chainMap] of Object.entries(GLOBAL_PAUSE_CONTRACT_NAME_OVERRIDES)) {
      for (const [address, name] of Object.entries(chainMap)) {
        expect(typeof name, `chain ${chainId} / ${address} name not a string`).toBe('string')
        expect(name.length, `chain ${chainId} / ${address} has empty name`).toBeGreaterThan(0)
      }
    }
  })
})

describe('getGlobalPauseContractNameOverride', () => {
  it('is case-insensitive on the address key', () => {
    const { address, name } = firstOverrideEntry(1)
    expect(getGlobalPauseContractNameOverride(1, address.toUpperCase())).toBe(name)
    expect(getGlobalPauseContractNameOverride(1, address.toLowerCase())).toBe(name)
  })

  it('returns null for unknown addresses', () => {
    expect(getGlobalPauseContractNameOverride(1, UNKNOWN_ADDRESS)).toBeNull()
  })

  it('returns null for unsupported chains', () => {
    expect(getGlobalPauseContractNameOverride(999999, UNKNOWN_ADDRESS)).toBeNull()
  })
})

describe('filterAddressesWithoutOverride', () => {
  it('drops addresses that are already covered by the manual map', () => {
    const { address } = firstOverrideEntry(1)
    const leftover = filterAddressesWithoutOverride(1, [address, UNKNOWN_ADDRESS])
    expect(leftover).toEqual([UNKNOWN_ADDRESS])
  })

  it('returns all addresses when the chain is unsupported', () => {
    const addrs = [UNKNOWN_ADDRESS, '0x2222222222222222222222222222222222222222']
    expect(filterAddressesWithoutOverride(999999, addrs)).toEqual(addrs)
  })
})
