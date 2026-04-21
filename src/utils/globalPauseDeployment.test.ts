import { describe, expect, it, vi } from 'vitest'
import {
  fetchGlobalPauseAddress,
  getGlobalPauseDeploymentUrl,
  parseGlobalPauseArtifact,
} from '@/utils/globalPauseDeployment'

describe('parseGlobalPauseArtifact', () => {
  it('returns a checksummed address from a valid artifact', () => {
    const addr = parseGlobalPauseArtifact({ address: '0x1111111111111111111111111111111111111111' })
    expect(addr).toBe('0x1111111111111111111111111111111111111111')
  })

  it('checksums mixed-case input to its canonical form', () => {
    const addr = parseGlobalPauseArtifact({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
    expect(addr).not.toBeNull()
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(addr!.toLowerCase()).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('returns null for invalid addresses or missing fields', () => {
    expect(parseGlobalPauseArtifact({})).toBeNull()
    expect(parseGlobalPauseArtifact({ address: 'not-an-address' })).toBeNull()
    expect(parseGlobalPauseArtifact(null)).toBeNull()
    expect(parseGlobalPauseArtifact({ address: 123 })).toBeNull()
  })
})

describe('getGlobalPauseDeploymentUrl', () => {
  it('uses master branch and the per-chain directory', () => {
    expect(getGlobalPauseDeploymentUrl('arbitrum_one')).toBe(
      'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/master/silo-core/deployments/arbitrum_one/GlobalPause.sol.json'
    )
  })
})

describe('fetchGlobalPauseAddress', () => {
  it('maps a supported chainId to the right URL and extracts the address', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(getGlobalPauseDeploymentUrl('arbitrum_one'))
      return new Response(
        JSON.stringify({ address: '0x2222222222222222222222222222222222222222', abi: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const deployment = await fetchGlobalPauseAddress(42161, { fetchImpl })
    expect(deployment).toEqual({
      chainId: 42161,
      chainName: 'arbitrum_one',
      address: '0x2222222222222222222222222222222222222222',
      sourceUrl: getGlobalPauseDeploymentUrl('arbitrum_one'),
    })
  })

  it('throws a readable error on HTTP 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    await expect(fetchGlobalPauseAddress(1, { fetchImpl })).rejects.toThrow(/do not publish a GlobalPause artifact/)
  })

  it('throws when the artifact is missing an address', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ abi: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    ) as unknown as typeof fetch
    await expect(fetchGlobalPauseAddress(1, { fetchImpl })).rejects.toThrow(/no valid `address` field/)
  })

  it('rejects unsupported chains', async () => {
    await expect(fetchGlobalPauseAddress(999999)).rejects.toThrow(/not supported/)
  })
})
