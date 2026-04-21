import { describe, expect, it } from 'vitest'
import {
  _resetGlobalPauseContractNamesCache,
  fetchGlobalPauseContractNames,
} from '@/utils/globalPauseContractNames'

const ADDR_LEVERAGE = '0x1111111111111111111111111111111111111111'
const ADDR_ROUTER = '0x2222222222222222222222222222222222222222'
const ADDR_SILO = '0x3333333333333333333333333333333333333333'
const ADDR_UNKNOWN = '0x4444444444444444444444444444444444444444'

type Artifact = { name: string; address: string | null }

function makeFetch(params: {
  contents: Artifact[]
  onVisit?: (artifactName: string) => void
}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    void init
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    if (href.includes('api.github.com/repos/') && href.includes('/contents/silo-core/deployments/')) {
      const listing = params.contents.map((a) => ({
        name: a.name,
        path: `silo-core/deployments/test/${a.name}`,
        type: 'file',
        download_url: `https://example.test/${a.name}`,
      }))
      return new Response(JSON.stringify(listing), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const match = params.contents.find((a) => href.endsWith(`/${a.name}`))
    if (!match) return new Response('not found', { status: 404 })
    params.onVisit?.(match.name)
    const body = match.address != null ? { address: match.address, abi: [] } : { abi: [] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

describe('fetchGlobalPauseContractNames', () => {
  it('resolves names and visits leverage/router artifacts before the rest', async () => {
    _resetGlobalPauseContractNamesCache()
    const visits: string[] = []
    const fetchImpl = makeFetch({
      contents: [
        { name: 'Silo.sol.json', address: ADDR_SILO },
        { name: 'SiloLeverageRouter.sol.json', address: ADDR_LEVERAGE },
        { name: 'SiloRouter.sol.json', address: ADDR_ROUTER },
        { name: 'IrmFactory.sol.json', address: '0x9999999999999999999999999999999999999999' },
      ],
      onVisit: (name) => visits.push(name),
    })

    const resolved = await fetchGlobalPauseContractNames(
      'test',
      [ADDR_LEVERAGE, ADDR_ROUTER, ADDR_SILO],
      { fetchImpl, concurrency: 1 }
    )

    expect(resolved.get(ADDR_LEVERAGE.toLowerCase())).toBe('SiloLeverageRouter')
    expect(resolved.get(ADDR_ROUTER.toLowerCase())).toBe('SiloRouter')
    expect(resolved.get(ADDR_SILO.toLowerCase())).toBe('Silo')

    const leverageIdx = visits.indexOf('SiloLeverageRouter.sol.json')
    const routerIdx = visits.indexOf('SiloRouter.sol.json')
    const siloIdx = visits.indexOf('Silo.sol.json')
    expect(leverageIdx).toBeGreaterThanOrEqual(0)
    expect(routerIdx).toBeGreaterThanOrEqual(0)
    expect(siloIdx).toBeGreaterThanOrEqual(0)
    expect(leverageIdx).toBeLessThan(siloIdx)
    expect(routerIdx).toBeLessThan(siloIdx)
  })

  it('short-circuits once every address is resolved and leaves non-matches unresolved', async () => {
    _resetGlobalPauseContractNamesCache()
    const visits: string[] = []
    const fetchImpl = makeFetch({
      contents: [
        { name: 'SiloLeverageRouter.sol.json', address: ADDR_LEVERAGE },
        { name: 'SiloRouter.sol.json', address: ADDR_ROUTER },
        { name: 'Silo.sol.json', address: ADDR_SILO },
        { name: 'IrmFactory.sol.json', address: '0x9999999999999999999999999999999999999999' },
      ],
      onVisit: (name) => visits.push(name),
    })

    const resolved = await fetchGlobalPauseContractNames('test', [ADDR_LEVERAGE, ADDR_ROUTER], {
      fetchImpl,
      concurrency: 1,
    })

    expect(resolved.size).toBe(2)
    expect(resolved.get(ADDR_LEVERAGE.toLowerCase())).toBe('SiloLeverageRouter')
    expect(resolved.get(ADDR_ROUTER.toLowerCase())).toBe('SiloRouter')
    expect(visits).not.toContain('Silo.sol.json')
    expect(visits).not.toContain('IrmFactory.sol.json')
  })

  it('leaves unknown addresses out of the result map', async () => {
    _resetGlobalPauseContractNamesCache()
    const fetchImpl = makeFetch({
      contents: [
        { name: 'SiloRouter.sol.json', address: ADDR_ROUTER },
        { name: 'Silo.sol.json', address: ADDR_SILO },
      ],
    })
    const resolved = await fetchGlobalPauseContractNames('test', [ADDR_UNKNOWN, ADDR_ROUTER], {
      fetchImpl,
      concurrency: 1,
    })
    expect(resolved.get(ADDR_ROUTER.toLowerCase())).toBe('SiloRouter')
    expect(resolved.has(ADDR_UNKNOWN.toLowerCase())).toBe(false)
  })

  it('caches results per (chain, address set) — second call does not re-fetch', async () => {
    _resetGlobalPauseContractNamesCache()
    let listingCalls = 0
    const fetchImpl = ((url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (href.includes('/contents/silo-core/deployments/')) {
        listingCalls += 1
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: 'SiloRouter.sol.json',
                path: 'x',
                type: 'file',
                download_url: 'https://example.test/SiloRouter.sol.json',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ address: ADDR_ROUTER, abi: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    }) as unknown as typeof fetch

    await fetchGlobalPauseContractNames('test', [ADDR_ROUTER], { fetchImpl })
    await fetchGlobalPauseContractNames('test', [ADDR_ROUTER], { fetchImpl })
    expect(listingCalls).toBe(1)
  })
})
