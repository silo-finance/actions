import { getAddress } from 'ethers'

export type SiloV3VaultListItem = {
  id: string
  name: string | null
  chainId: number
}

const DEFAULT_GRAPHQL_URL = 'https://api-v3.silo.finance/graphql'

/** Public Silo v3 Ponder GraphQL; override for staging via `NEXT_PUBLIC_SILO_V3_GRAPHQL_URL`. */
export function getSiloV3GraphqlUrl(): string {
  const u = process.env.NEXT_PUBLIC_SILO_V3_GRAPHQL_URL?.trim()
  return u && u.length > 0 ? u : DEFAULT_GRAPHQL_URL
}

const GET_VAULTS_BY_ACCOUNT = `
query getVaultsByAccount($account: String!, $chainId: Int!) {
  vaults(
    limit: 100
    where: {
      AND: [
        { chainId: $chainId }
        {
          OR: [
            { curatorId: $account }
            { guardianId: $account }
            { ownerId: $account }
          ]
        }
      ]
    }
  ) {
    items {
      id
      name
      chainId
    }
  }
}
`

type GraphqlVaultsResponse = {
  data?: {
    vaults?: { items?: Array<{ id: string; name: string | null; chainId: number }> }
  }
  errors?: Array<{ message?: string }>
}

/**
 * Vaults on `chainId` where `account` is owner, curator, or guardian (Silo v3 indexer).
 * `account` is normalized to lowercase for ID fields in the index.
 */
export async function fetchVaultsManagedByAccount(
  account: string,
  chainId: number,
  graphqlUrl: string = getSiloV3GraphqlUrl()
): Promise<SiloV3VaultListItem[]> {
  const checksummed = getAddress(account)
  const accountKey = checksummed.toLowerCase()

  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GET_VAULTS_BY_ACCOUNT,
      variables: { account: accountKey, chainId },
    }),
  })

  if (!res.ok) {
    throw new Error(`Silo API HTTP ${res.status}`)
  }

  const json = (await res.json()) as GraphqlVaultsResponse
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message ?? '').filter(Boolean).join('; ')
    throw new Error(msg || 'Silo API GraphQL error')
  }

  const raw = json.data?.vaults?.items ?? []
  const seen = new Set<string>()
  const out: SiloV3VaultListItem[] = []
  for (const row of raw) {
    if (!row?.id) continue
    let id: string
    try {
      id = getAddress(row.id)
    } catch {
      continue
    }
    const k = id.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      id,
      name: row.name ?? null,
      chainId: typeof row.chainId === 'number' ? row.chainId : chainId,
    })
  }

  out.sort((a, b) => {
    const na = (a.name ?? '').toLowerCase()
    const nb = (b.name ?? '').toLowerCase()
    if (na !== nb) return na.localeCompare(nb)
    return a.id.toLowerCase().localeCompare(b.id.toLowerCase())
  })

  return out
}
