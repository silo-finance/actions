const LIQ_GRAPHQL_URL_DEFAULT = 'https://api-v3.silo.finance/graphql'
let graphqlRequestSeq = 0

type PositionCountBatchResponse = {
  data?: {
    markets?: {
      items?: Array<{
        id: string
        positions?: {
          totalCount?: number
        }
      }>
    }
  }
  errors?: Array<{ message?: string }>
}

type PositionListResponse = {
  data?: {
    positions?: {
      totalCount?: number
      items?: Array<{
        id: string
        accountId: string
        ltv: string | null
        debtValue: string | null
        collateralValue: string | null
        debtAssets: string | null
        collateralAssets: string | null
        isInBadDet: string | null
      }>
      pageInfo?: {
        hasNextPage?: boolean
      }
    }
  }
  errors?: Array<{ message?: string }>
}

const POSITION_COUNTS_QUERY = `
query PositionsCountByMarkets($chainId: Int!, $marketIds: [String!], $limit: Int!, $offset: Int!) {
  markets(
    where: { chainId: $chainId, id_in: $marketIds }
    limit: $limit
    offset: $offset
  ) {
    items {
      id
      positions(where: { isOpen: true, ltv_gt: "0" }, limit: 1, offset: 0) {
        totalCount
      }
    }
  }
}
`

const OPEN_POSITIONS_BY_MARKET_QUERY = `
query OpenPositionsByMarket($chainId: Int!, $marketId: String!, $limit: Int!, $offset: Int!) {
  positions(
    where: { chainId: $chainId, marketId: $marketId, isOpen: true, ltv_gt: "0" }
    orderBy: "debtValue"
    orderDirection: "desc"
    limit: $limit
    offset: $offset
  ) {
    totalCount
    items {
      id
      accountId
      ltv
      debtValue
      collateralValue
      debtAssets
      collateralAssets
      isInBadDet
    }
    pageInfo {
      hasNextPage
    }
  }
}
`

export type OpenMarketPosition = {
  id: string
  accountId: string
  ltv: string | null
  debtValue: string | null
  collateralValue: string | null
  debtAssets: string | null
  collateralAssets: string | null
  isInBadDet: string | null
}

export function getLiquidationGraphqlUrl(): string {
  const raw =
    typeof process !== 'undefined' && process.env.NEXT_PUBLIC_LIQ_GRAPHQL_URL
      ? process.env.NEXT_PUBLIC_LIQ_GRAPHQL_URL.trim()
      : ''
  return (raw || LIQ_GRAPHQL_URL_DEFAULT).replace(/\/$/, '')
}

function buildGraphqlError(
  message: string,
  query: string,
  variables: Record<string, unknown>,
  extra?: Record<string, unknown>
): Error {
  const error = new Error(message) as Error & {
    query?: string
    variables?: Record<string, unknown>
    extra?: Record<string, unknown>
  }
  error.query = query
  error.variables = variables
  if (extra) error.extra = extra
  return error
}

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function buildPlaygroundBlocks(query: string, variables: Record<string, unknown>): string {
  return [
    '----- GRAPHQL PLAYGROUND: QUERY START -----',
    query.trim(),
    '----- GRAPHQL PLAYGROUND: QUERY END -----',
    '----- GRAPHQL PLAYGROUND: VARIABLES START -----',
    stringifyPretty(variables),
    '----- GRAPHQL PLAYGROUND: VARIABLES END -----',
  ].join('\n')
}

async function postGraphql<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
  const endpoint = getLiquidationGraphqlUrl()
  graphqlRequestSeq += 1
  const requestId = graphqlRequestSeq
  const payload = { query, variables }
  const playgroundBlocks = buildPlaygroundBlocks(query, variables)
  console.groupCollapsed(`[liq-graphql:${requestId}] request`)
  console.info('Endpoint:', endpoint)
  console.info('Query (playground-ready):\n%s', query)
  console.info('Variables (playground-ready):\n%s', stringifyPretty(variables))
  console.info('%s', playgroundBlocks)
  console.groupEnd()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    console.group(`[liq-graphql:${requestId}] error`)
    console.error('Endpoint:', endpoint)
    console.error('Status:', res.status, res.statusText)
    console.error('Query (playground-ready):\n%s', query)
    console.error('Variables (playground-ready):\n%s', stringifyPretty(variables))
    console.error('%s', playgroundBlocks)
    console.error('Response body:\n' + (bodyText || '<empty>'))
    console.groupEnd()
    throw buildGraphqlError(`GraphQL HTTP ${res.status} ${res.statusText}; body=${bodyText || '<empty>'}`, query, variables, {
      endpoint,
      status: res.status,
      statusText: res.statusText,
      body: bodyText || '<empty>',
    })
  }
  const json = (await res.json()) as { data?: TData; errors?: Array<{ message?: string }> }
  if (json.errors?.length) {
    const msg = json.errors.map((x) => x.message ?? '').filter(Boolean).join('; ')
    console.group(`[liq-graphql:${requestId}] graphql-errors`)
    console.error('Endpoint:', endpoint)
    console.error('Query (playground-ready):\n%s', query)
    console.error('Variables (playground-ready):\n%s', stringifyPretty(variables))
    console.error('%s', playgroundBlocks)
    console.error('Errors:\n' + stringifyPretty(json.errors))
    console.groupEnd()
    throw buildGraphqlError(msg || 'GraphQL query failed', query, variables, {
      endpoint,
      graphqlErrors: json.errors,
    })
  }
  if (!json.data) {
    console.group(`[liq-graphql:${requestId}] empty-data`)
    console.error('Endpoint:', endpoint)
    console.error('Query (playground-ready):\n%s', query)
    console.error('Variables (playground-ready):\n%s', stringifyPretty(variables))
    console.error('%s', playgroundBlocks)
    console.error('Raw response:\n' + stringifyPretty(json))
    console.groupEnd()
    throw buildGraphqlError('GraphQL returned empty data', query, variables, {
      endpoint,
      rawResponse: json,
    })
  }
  console.info(`[liq-graphql:${requestId}] ok`)
  return json.data
}

function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length <= size) return [values]
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

export async function fetchOpenPositionCountsByMarket(
  chainId: number,
  siloAddresses: string[],
  marketChunkSize: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (siloAddresses.length === 0) return out

  const chunks = chunkValues(siloAddresses, Math.max(1, marketChunkSize))
  for (const chunk of chunks) {
    const data = await postGraphql<PositionCountBatchResponse['data']>(POSITION_COUNTS_QUERY, {
      chainId,
      marketIds: chunk,
      limit: chunk.length,
      offset: 0,
    })
    const items = data?.markets?.items ?? []
    for (const item of items) {
      out.set(item.id.toLowerCase(), item.positions?.totalCount ?? 0)
    }
  }

  for (const id of siloAddresses) {
    if (!out.has(id.toLowerCase())) out.set(id.toLowerCase(), 0)
  }
  return out
}

export async function fetchOpenPositionsByMarket(
  chainId: number,
  siloAddress: string,
  limit: number,
  offset: number
): Promise<{ items: OpenMarketPosition[]; totalCount: number; hasNextPage: boolean }> {
  const data = await postGraphql<PositionListResponse['data']>(OPEN_POSITIONS_BY_MARKET_QUERY, {
    chainId,
    marketId: siloAddress,
    limit,
    offset,
  })
  const page = data?.positions
  return {
    items: (page?.items ?? []) as OpenMarketPosition[],
    totalCount: page?.totalCount ?? 0,
    hasNextPage: Boolean(page?.pageInfo?.hasNextPage),
  }
}

export async function fetchAllOpenPositionsByMarket(
  chainId: number,
  siloAddress: string,
  pageLimit: number
): Promise<OpenMarketPosition[]> {
  const out: OpenMarketPosition[] = []
  const limit = Math.max(1, pageLimit)
  let offset = 0
  while (true) {
    const page = await fetchOpenPositionsByMarket(chainId, siloAddress, limit, offset)
    out.push(...page.items)
    if (!page.hasNextPage) break
    offset += limit
  }
  return out
}
