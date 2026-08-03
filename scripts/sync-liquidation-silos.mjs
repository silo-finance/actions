#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, FetchRequest, Interface, JsonRpcProvider, getAddress } from 'ethers'
import SiloAbi from '../src/abis/Silo.json' with { type: 'json' }
import SiloConfigAbi from '../src/abis/SiloConfig.json' with { type: 'json' }
import Erc20Abi from '../src/abis/ERC20.json' with { type: 'json' }
import SiloOracleAbi from '../src/abis/ISiloOracle.json' with { type: 'json' }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotDir = join(root, 'src', 'data', 'silos')
const blacklistDir = join(snapshotDir, 'blacklist')
const legacyWhitelistDir = join(root, 'src', 'data', 'positions')

const CHAIN_ID_BY_KEY = {
  ethereum: 1,
  xdc: 50,
  sonic: 146,
  injective: 1776,
  arbitrum: 42161,
  avalanche: 43114,
}
const SUPPORTED_CHAIN_KEYS = Object.keys(CHAIN_ID_BY_KEY)

const EARN_SILOS_URL = (process.env.EARN_SILOS_URL || 'https://app.silo.finance/api/earn-silos').replace(/\/$/, '')
const LIQ_GRAPHQL_URL = (
  process.env.LIQ_GRAPHQL_URL ||
  process.env.NEXT_PUBLIC_LIQ_GRAPHQL_URL ||
  'https://api-v3.silo.finance/graphql'
).replace(/\/$/, '')
// Cloudflare-fronted gateways/RPC nodes ban the default urllib/node user agent (403 / code 1010);
// present a browser-like signature on every outbound request instead.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const EARN_PAGE_SIZE = Number(process.env.TEST_API_LIMIT || 1000)
const GRAPHQL_PAGE_SIZE = Number(process.env.TEST_GRAPH_LIMIT || 200)
const V3_SILO_ID_MIN = 3000
const siloAbi = Array.isArray(SiloAbi) ? SiloAbi : SiloAbi.abi
const siloConfigAbi = Array.isArray(SiloConfigAbi) ? SiloConfigAbi : SiloConfigAbi.abi
const erc20Abi = Array.isArray(Erc20Abi) ? Erc20Abi : Erc20Abi.abi
const siloOracleAbi = Array.isArray(SiloOracleAbi) ? SiloOracleAbi : SiloOracleAbi
const siloInterface = new Interface(siloAbi)
const siloConfigInterface = new Interface(siloConfigAbi)
const erc20Interface = new Interface(erc20Abi)
const siloOracleInterface = new Interface(siloOracleAbi)
const multicall3Interface = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
])
const MULTICALL3_BY_CHAIN_ID = {
  1: '0xca11bde05977b3631167028862be2a173976ca11',
  50: '0x0b1795cca8e4ec4df02346a082df54d437f8d9af',
  146: '0xca11bde05977b3631167028862be2a173976ca11',
  1776: '0xca11bde05977b3631167028862be2a173976ca11',
  42161: '0xca11bde05977b3631167028862be2a173976ca11',
  43114: '0xca11bde05977b3631167028862be2a173976ca11',
}

const DEFAULT_RPC_BY_CHAIN = {
  ethereum: 'https://ethereum.publicnode.com',
  xdc: 'https://rpc.xdcrpc.com',
  sonic: 'https://rpc.soniclabs.com',
  injective: 'https://sentry.evm-rpc.injective.network',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
}

function getRpcUrl(chainKey) {
  const upper = chainKey.toUpperCase()
  const fromEnv = (
    process.env[`RPC_URL_${upper}`] ||
    process.env[`NEXT_PUBLIC_RPC_${upper}`] ||
    ''
  ).trim()
  if (fromEnv) return fromEnv
  return DEFAULT_RPC_BY_CHAIN[chainKey]
}

function createRpcFetchRequest(rpcUrl) {
  const fetchRequest = new FetchRequest(rpcUrl)
  fetchRequest.setHeader('User-Agent', BROWSER_USER_AGENT)
  return fetchRequest
}

const args = process.argv.slice(2)
const mode = args[0] || 'full'
const flagMap = new Map(
  args
    .slice(1)
    .map((arg) => (arg.startsWith('--') ? arg.slice(2) : ''))
    .filter(Boolean)
    .map((arg) => {
      const [k, ...rest] = arg.split('=')
      return [k, rest.join('=')]
    })
)

function getFlag(name) {
  return flagMap.get(name)
}

function splitCsv(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeAddress(raw) {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(t)) return null
  return t
}

function checksumAddress(raw) {
  if (!raw) return null
  try {
    return getAddress(raw).toLowerCase()
  } catch {
    return null
  }
}

function ensureSnapshotDir() {
  mkdirSync(snapshotDir, { recursive: true })
}

function ensureBlacklistDir() {
  mkdirSync(blacklistDir, { recursive: true })
}

function blacklistPath(chainKey) {
  return join(blacklistDir, `${chainKey}.json`)
}

function readBlacklistAddresses(chainKey) {
  ensureBlacklistDir()
  const fullPath = blacklistPath(chainKey)
  if (!existsSync(fullPath)) return []
  const payload = JSON.parse(readFileSync(fullPath, 'utf8'))
  if (!Array.isArray(payload)) {
    throw new Error(`Invalid blacklist format in ${fullPath}`)
  }
  return [
    ...new Set(
      payload
        .map((entry) => (typeof entry === 'string' ? normalizeAddress(entry) : null))
        .filter(Boolean)
    ),
  ].sort()
}

function writeBlacklistAddresses(chainKey, addresses) {
  ensureBlacklistDir()
  const unique = [...new Set(addresses.map((entry) => normalizeAddress(entry)).filter(Boolean))].sort()
  writeFileSync(blacklistPath(chainKey), `${JSON.stringify(unique, null, 2)}\n`, 'utf8')
  return unique
}

function addToBlacklist(chainKey, siloAddress) {
  const current = readBlacklistAddresses(chainKey)
  if (current.includes(siloAddress)) {
    console.log(`[sync-liquidation-silos] blacklist already contains ${siloAddress} for ${chainKey}`)
    return current
  }
  const next = writeBlacklistAddresses(chainKey, [...current, siloAddress])
  console.log(
    `[sync-liquidation-silos] blacklist added ${siloAddress} for ${chainKey} (${next.length} total)`
  )
  return next
}

function removeFromBlacklist(chainKey, siloAddress) {
  const current = readBlacklistAddresses(chainKey)
  const next = current.filter((entry) => entry !== siloAddress)
  if (next.length === current.length) {
    console.log(`[sync-liquidation-silos] blacklist skip missing ${siloAddress} for ${chainKey}`)
    return current
  }
  writeBlacklistAddresses(chainKey, next)
  console.log(
    `[sync-liquidation-silos] blacklist removed ${siloAddress} for ${chainKey} (kept ${next.length})`
  )
  return next
}

function loadSnapshotByChain() {
  ensureSnapshotDir()
  const out = new Map()
  for (const chainKey of SUPPORTED_CHAIN_KEYS) {
    const fullPath = join(snapshotDir, `${chainKey}.json`)
    if (!existsSync(fullPath)) continue
    const parsed = JSON.parse(readFileSync(fullPath, 'utf8'))
    const silos = Array.isArray(parsed.silos) ? parsed.silos : []
    out.set(chainKey, {
      chainId: parsed.chainId ?? CHAIN_ID_BY_KEY[chainKey] ?? null,
      chainKey,
      silos,
    })
  }
  return out
}

function marketVersionOf(row) {
  return row?.marketVersion === 'legacy' ? 'legacy' : 'v3'
}

function writeChainSnapshot(chainKey, chainId, silos) {
  ensureSnapshotDir()
  const fullPath = join(snapshotDir, `${chainKey}.json`)
  const sorted = [...silos].sort((a, b) => {
    const aId = a.siloId ?? -1
    const bId = b.siloId ?? -1
    if (aId !== bId) return bId - aId
    return a.siloAddress.localeCompare(b.siloAddress)
  })
  const payload = {
    chainId,
    chainKey,
    generatedAt: new Date().toISOString(),
    silos: sorted,
  }
  writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`)
}

async function fetchEarnSilosForChain(chainKey) {
  const out = []
  let offset = 0
  for (;;) {
    const body = {
      siloIds: [],
      search: null,
      riskProfiles: [],
      chainKeys: [chainKey],
      minTotalSupplyUsd: null,
      sort: null,
      limit: EARN_PAGE_SIZE,
      offset,
    }
    const res = await fetch(EARN_SILOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_USER_AGENT },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`earn-silos HTTP ${res.status}`)
    const json = await res.json()
    const silos = Array.isArray(json.silos) ? json.silos : []
    out.push(...silos)
    if (silos.length < EARN_PAGE_SIZE) break
    offset += EARN_PAGE_SIZE
  }
  return out
}

const V3_MARKETS_QUERY = `
query V3MarketsByChain($chainId: Int!, $limit: Int!, $offset: Int!) {
  markets(limit: $limit, offset: $offset, where: { chainId: $chainId }) {
    items {
      id
      silo {
        siloId
      }
    }
  }
}
`

async function fetchV3MarketAddressesForChain(chainId) {
  const out = new Set()
  let offset = 0
  const pageSize = Number.isFinite(GRAPHQL_PAGE_SIZE) && GRAPHQL_PAGE_SIZE > 0 ? GRAPHQL_PAGE_SIZE : 200

  for (;;) {
    const res = await fetch(LIQ_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_USER_AGENT },
      body: JSON.stringify({
        query: V3_MARKETS_QUERY,
        variables: { chainId, limit: pageSize, offset },
      }),
    })
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
    const json = await res.json()
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      const msg = json.errors.map((e) => e?.message ?? '').filter(Boolean).join('; ')
      throw new Error(msg || 'GraphQL error while listing v3 markets')
    }
    const items = json?.data?.markets?.items
    if (!Array.isArray(items) || items.length === 0) break
    for (const item of items) {
      const siloId = Number(item?.silo?.siloId)
      if (!Number.isFinite(siloId) || siloId < V3_SILO_ID_MIN) continue
      const address = normalizeAddress(item?.id)
      if (address) out.add(address)
    }
    if (items.length < pageSize) break
    offset += pageSize
  }

  return out
}

function normalizeConfigData(config) {
  if (!config) return null
  return {
    daoFee: String(config.daoFee ?? ''),
    deployerFee: String(config.deployerFee ?? ''),
    silo: checksumAddress(config.silo) ?? '',
    token: checksumAddress(config.token) ?? '',
    protectedShareToken: checksumAddress(config.protectedShareToken) ?? '',
    collateralShareToken: checksumAddress(config.collateralShareToken) ?? '',
    debtShareToken: checksumAddress(config.debtShareToken) ?? '',
    solvencyOracle: checksumAddress(config.solvencyOracle) ?? '',
    maxLtvOracle: checksumAddress(config.maxLtvOracle) ?? '',
    interestRateModel: checksumAddress(config.interestRateModel) ?? '',
    maxLtv: String(config.maxLtv ?? ''),
    lt: String(config.lt ?? ''),
    liquidationTargetLtv: String(config.liquidationTargetLtv ?? ''),
    liquidationFee: String(config.liquidationFee ?? ''),
    flashloanFee: String(config.flashloanFee ?? ''),
    hookReceiver: checksumAddress(config.hookReceiver) ?? '',
    callBeforeQuote: Boolean(config.callBeforeQuote),
  }
}

async function resolveTokenMeta(provider, tokenAddress) {
  const token = new Contract(tokenAddress, erc20Abi, provider)
  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(() => null),
    token.decimals().catch(() => null),
  ])
  return {
    tokenSymbol: typeof symbol === 'string' ? symbol : null,
    tokenDecimals: decimals != null ? Number(decimals) : null,
  }
}

function chunkValues(values, size) {
  if (values.length <= size) return [values]
  const out = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function executeMulticallWithFallback(provider, chainId, calls, chunkSize = 128) {
  if (calls.length === 0) return []
  const multicallAddress = MULTICALL3_BY_CHAIN_ID[chainId]
  if (!multicallAddress) {
    return Promise.all(calls.map((call) => call.fallback()))
  }

  const out = []
  for (const chunk of chunkValues(calls, chunkSize)) {
    const payload = chunk.map((call) => ({
      target: getAddress(call.target),
      allowFailure: true,
      callData: call.callData,
    }))
    const encoded = multicall3Interface.encodeFunctionData('aggregate3', [payload])
    let decoded
    try {
      const raw = await provider.call({
        to: multicallAddress,
        data: encoded,
      })
      decoded = multicall3Interface.decodeFunctionResult('aggregate3', raw)[0]
    } catch {
      const fallbackResults = await Promise.all(chunk.map((call) => call.fallback()))
      out.push(...fallbackResults)
      continue
    }

    for (let i = 0; i < chunk.length; i += 1) {
      const call = chunk[i]
      const result = decoded[i]
      if (!result?.success) {
        out.push(await call.fallback())
        continue
      }
      out.push(call.decode(result.returnData))
    }
  }
  return out
}

async function refreshTargets(targetsByChain) {
  const outByChain = new Map()
  for (const [chainKey, addressesSet] of targetsByChain) {
    const chainId = CHAIN_ID_BY_KEY[chainKey]
    if (!chainId) {
      console.warn(`[sync-liquidation-silos] skipping unsupported chain key: ${chainKey}`)
      continue
    }
    const rpcUrl = getRpcUrl(chainKey)
    if (!rpcUrl) throw new Error(`Missing RPC url for ${chainKey}`)
    const provider = new JsonRpcProvider(createRpcFetchRequest(rpcUrl), chainId)

    const siloAddresses = [...addressesSet]
    const configCalls = siloAddresses.map((siloAddress) => ({
      target: siloAddress,
      callData: siloInterface.encodeFunctionData('config', []),
      decode: (returnData) => checksumAddress(siloInterface.decodeFunctionResult('config', returnData)[0]) ?? null,
      fallback: async () => {
        const siloContract = new Contract(siloAddress, siloAbi, provider)
        const configAddress = await siloContract.config().catch(() => null)
        return checksumAddress(configAddress)
      },
    }))
    const configResults = await executeMulticallWithFallback(provider, chainId, configCalls)
    const configBySilo = new Map(
      siloAddresses.map((siloAddress, index) => [siloAddress, configResults[index] ?? null])
    )

    const uniqueConfigs = [...new Set([...configBySilo.values()].filter(Boolean))]
    const configContracts = new Map(uniqueConfigs.map((cfg) => [cfg, new Contract(cfg, siloConfigAbi, provider)]))
    const siloIdCalls = uniqueConfigs.map((configAddress) => ({
      target: configAddress,
      callData: siloConfigInterface.encodeFunctionData('SILO_ID', []),
      decode: (returnData) => {
        const value = siloConfigInterface.decodeFunctionResult('SILO_ID', returnData)[0]
        return value != null ? Number(value) : null
      },
      fallback: async () => {
        const contract = configContracts.get(configAddress)
        const rawId = await contract.SILO_ID().catch(() => null)
        return rawId != null ? Number(rawId) : null
      },
    }))
    const siloIdResults = await executeMulticallWithFallback(provider, chainId, siloIdCalls)
    const numericIdByConfig = new Map(uniqueConfigs.map((cfg, index) => [cfg, siloIdResults[index] ?? null]))

    const silosByConfigCalls = uniqueConfigs.map((configAddress) => ({
      configAddress,
      target: configAddress,
      callData: siloConfigInterface.encodeFunctionData('getSilos', []),
      decode: (returnData) => {
        const decoded = siloConfigInterface.decodeFunctionResult('getSilos', returnData)
        return {
          silo0: checksumAddress(decoded[0]) ?? null,
          silo1: checksumAddress(decoded[1]) ?? null,
        }
      },
      fallback: async () => {
        const contract = configContracts.get(configAddress)
        const raw = await contract.getSilos().catch(() => null)
        if (!raw) return { silo0: null, silo1: null }
        return {
          silo0: checksumAddress(raw[0]) ?? null,
          silo1: checksumAddress(raw[1]) ?? null,
        }
      },
    }))
    const silosByConfigResults = await executeMulticallWithFallback(provider, chainId, silosByConfigCalls)
    const silosByConfig = new Map(uniqueConfigs.map((cfg, index) => [cfg, silosByConfigResults[index] ?? null]))

    const configTargetsByKey = new Map()
    for (const siloAddress of siloAddresses) {
      const configAddress = configBySilo.get(siloAddress) ?? null
      if (!configAddress) continue
      configTargetsByKey.set(`${configAddress}:${siloAddress}`, { configAddress, siloAddress })
      const pair = silosByConfig.get(configAddress)
      const otherAddress = pair
        ? pair.silo0 === siloAddress
          ? pair.silo1
          : pair.silo1 === siloAddress
            ? pair.silo0
            : null
        : null
      if (otherAddress) {
        configTargetsByKey.set(`${configAddress}:${otherAddress}`, { configAddress, siloAddress: otherAddress })
      }
    }

    const configDataTargets = [...configTargetsByKey.values()]
    const configDataCalls = configDataTargets.map((pair) => ({
      siloAddress: pair.siloAddress,
      configAddress: pair.configAddress,
      target: pair.configAddress,
      callData: siloConfigInterface.encodeFunctionData('getConfig', [pair.siloAddress]),
      decode: (returnData) => normalizeConfigData(siloConfigInterface.decodeFunctionResult('getConfig', returnData)[0]),
      fallback: async () => {
        const contract = configContracts.get(pair.configAddress)
        const rawConfig = await contract.getConfig(pair.siloAddress).catch(() => null)
        return normalizeConfigData(rawConfig)
      },
    }))
    const configDataResults = await executeMulticallWithFallback(provider, chainId, configDataCalls)
    const configDataByKey = new Map(
      configDataCalls.map((call, index) => [`${call.configAddress}:${call.siloAddress}`, configDataResults[index] ?? null])
    )

    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
    const oracleAddresses = [...new Set(
      [...configDataByKey.values()]
        .map((cfg) => checksumAddress(cfg?.solvencyOracle ?? null))
        .filter((oracleAddress) => oracleAddress && oracleAddress !== ZERO_ADDRESS)
    )]
    const oracleQuoteTokenCalls = oracleAddresses.map((oracleAddress) => ({
      oracleAddress,
      target: oracleAddress,
      callData: siloOracleInterface.encodeFunctionData('quoteToken', []),
      decode: (returnData) => checksumAddress(siloOracleInterface.decodeFunctionResult('quoteToken', returnData)[0]) ?? null,
      fallback: async () => {
        const oracle = new Contract(oracleAddress, siloOracleAbi, provider)
        const quoteTokenAddress = await oracle.quoteToken().catch(() => null)
        return checksumAddress(quoteTokenAddress)
      },
    }))
    const oracleQuoteTokenResults = await executeMulticallWithFallback(provider, chainId, oracleQuoteTokenCalls)
    const quoteTokenByOracle = new Map(
      oracleQuoteTokenCalls.map((call, index) => [call.oracleAddress, oracleQuoteTokenResults[index] ?? null])
    )

    const tokenAddresses = [...new Set(
      [...configDataByKey.values()]
        .map((cfg) => checksumAddress(cfg?.token ?? null))
        .filter(Boolean)
    )]
    const quoteTokenAddresses = [...new Set([...quoteTokenByOracle.values()].filter(Boolean))]
    const tokenMetaAddresses = [...new Set([...tokenAddresses, ...quoteTokenAddresses])]
    const tokenMetaCalls = tokenMetaAddresses.flatMap((tokenAddress) => [
      {
        tokenAddress,
        field: 'symbol',
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData('symbol', []),
        decode: (returnData) => {
          const v = erc20Interface.decodeFunctionResult('symbol', returnData)[0]
          return typeof v === 'string' ? v : null
        },
        fallback: async () => (await resolveTokenMeta(provider, tokenAddress)).tokenSymbol,
      },
      {
        tokenAddress,
        field: 'decimals',
        target: tokenAddress,
        callData: erc20Interface.encodeFunctionData('decimals', []),
        decode: (returnData) => {
          const v = erc20Interface.decodeFunctionResult('decimals', returnData)[0]
          return v != null ? Number(v) : null
        },
        fallback: async () => (await resolveTokenMeta(provider, tokenAddress)).tokenDecimals,
      },
    ])
    const tokenMetaResults = await executeMulticallWithFallback(provider, chainId, tokenMetaCalls)
    const tokenMetaCache = new Map()
    for (let i = 0; i < tokenMetaCalls.length; i += 2) {
      const symbolCall = tokenMetaCalls[i]
      const decimalsCall = tokenMetaCalls[i + 1]
      tokenMetaCache.set(symbolCall.tokenAddress, {
        tokenSymbol: tokenMetaResults[i] ?? null,
        tokenDecimals: tokenMetaResults[i + 1] ?? null,
      })
    }

    const refreshed = []
    for (const siloAddress of siloAddresses) {
      const configAddress = configBySilo.get(siloAddress)
      if (!configAddress) {
        console.warn(`[sync-liquidation-silos] no silo config for ${chainKey}:${siloAddress}`)
        continue
      }
      const silosPair = silosByConfig.get(configAddress)
      const siloIndex = silosPair
        ? silosPair.silo0 === siloAddress
          ? 0
          : silosPair.silo1 === siloAddress
            ? 1
            : null
        : null
      const otherSiloAddress = silosPair
        ? siloIndex === 0
          ? silosPair.silo1
          : siloIndex === 1
            ? silosPair.silo0
            : null
        : null
      const configData = configDataByKey.get(`${configAddress}:${siloAddress}`) ?? null
      const tokenAddress = configData?.token ? checksumAddress(configData.token) : null
      const tokenMeta = tokenAddress ? tokenMetaCache.get(tokenAddress) : null
      const otherConfigData = otherSiloAddress ? configDataByKey.get(`${configAddress}:${otherSiloAddress}`) ?? null : null
      const otherTokenAddress = otherConfigData?.token ? checksumAddress(otherConfigData.token) : null
      const otherTokenMeta = otherTokenAddress ? tokenMetaCache.get(otherTokenAddress) : null
      const oracleAddress = checksumAddress(configData?.solvencyOracle ?? null)
      const otherOracleAddress = checksumAddress(otherConfigData?.solvencyOracle ?? null)
      const quoteTokenAddress =
        oracleAddress && oracleAddress !== ZERO_ADDRESS ? quoteTokenByOracle.get(oracleAddress) ?? null : null
      const otherQuoteTokenAddress =
        otherOracleAddress && otherOracleAddress !== ZERO_ADDRESS ? quoteTokenByOracle.get(otherOracleAddress) ?? null : null
      const quoteTokenSymbol =
        quoteTokenAddress && tokenMetaCache.get(quoteTokenAddress)?.tokenSymbol
          ? tokenMetaCache.get(quoteTokenAddress)?.tokenSymbol
          : tokenMeta?.tokenSymbol ?? null
      const otherQuoteTokenSymbol =
        otherQuoteTokenAddress && tokenMetaCache.get(otherQuoteTokenAddress)?.tokenSymbol
          ? tokenMetaCache.get(otherQuoteTokenAddress)?.tokenSymbol
          : otherTokenMeta?.tokenSymbol ?? null

      refreshed.push({
        chainId,
        chainKey,
        siloAddress,
        siloConfigAddress: configAddress,
        siloId: numericIdByConfig.get(configAddress) ?? null,
        siloIndex,
        tokenAddress,
        tokenSymbol: tokenMeta?.tokenSymbol ?? null,
        quoteTokenSymbol,
        tokenDecimals: tokenMeta?.tokenDecimals ?? null,
        siloConfig: configData,
        otherSilo: otherSiloAddress
          ? {
              siloAddress: otherSiloAddress,
              siloConfigAddress: configAddress,
              siloId: numericIdByConfig.get(configAddress) ?? null,
              tokenAddress: otherTokenAddress,
              tokenSymbol: otherTokenMeta?.tokenSymbol ?? null,
              quoteTokenSymbol: otherQuoteTokenSymbol,
              tokenDecimals: otherTokenMeta?.tokenDecimals ?? null,
              siloConfig: otherConfigData,
            }
          : null,
      })
    }
    outByChain.set(chainKey, refreshed)
  }
  return outByChain
}

async function runFullRefresh() {
  const chainFilter = splitCsv(getFlag('chainKeys'))
  const snapshot = loadSnapshotByChain()
  const chainKeys =
    chainFilter.length > 0
      ? chainFilter.filter((key) => CHAIN_ID_BY_KEY[key])
      : SUPPORTED_CHAIN_KEYS

  for (const chainKey of chainKeys) {
    const chainId = CHAIN_ID_BY_KEY[chainKey]
    const existing = snapshot.get(chainKey)?.silos ?? []
    const legacyRows = existing.filter((row) => marketVersionOf(row) === 'legacy')
    const blacklist = new Set(readBlacklistAddresses(chainKey))

    let gqlV3Addresses
    try {
      gqlV3Addresses = await fetchV3MarketAddressesForChain(chainId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to list GraphQL v3 markets for ${chainKey}: ${message}`)
    }

    let v3Targets = new Set(
      [...gqlV3Addresses].filter((address) => !blacklist.has(address))
    )

    if (gqlV3Addresses.size === 0) {
      const keptExistingV3 = existing
        .filter((row) => marketVersionOf(row) === 'v3')
        .map((row) => normalizeAddress(row.siloAddress))
        .filter((address) => address && !blacklist.has(address))
      v3Targets = new Set(keptExistingV3)
      console.warn(
        `[sync-liquidation-silos] GraphQL returned 0 v3 markets for ${chainKey}; keeping ${v3Targets.size} existing v3 row(s) minus blacklist`
      )
    }

    const refreshed =
      v3Targets.size > 0
        ? (await refreshTargets(new Map([[chainKey, v3Targets]]))).get(chainKey) ?? []
        : []
    const v3Rows = refreshed.map((row) => ({ ...row, marketVersion: 'v3' }))
    const merged = [...v3Rows, ...legacyRows]
    writeChainSnapshot(chainKey, chainId, merged)
    console.log(
      `[sync-liquidation-silos] full refresh wrote ${merged.length} records for ${chainKey} (v3=${v3Rows.length}, legacy=${legacyRows.length}, gql=${gqlV3Addresses.size}, blacklisted=${blacklist.size})`
    )
  }
}

async function runAddOrRefreshSingle() {
  const chainKey = (getFlag('chainKey') || '').toLowerCase()
  const siloAddress = normalizeAddress(getFlag('siloAddress') || '')
  if (!chainKey || !CHAIN_ID_BY_KEY[chainKey]) {
    throw new Error('add mode requires --chainKey=<supported-chain>')
  }
  if (!siloAddress) {
    throw new Error('add mode requires --siloAddress=0x...')
  }

  removeFromBlacklist(chainKey, siloAddress)

  const snapshot = loadSnapshotByChain()
  const current = snapshot.get(chainKey)?.silos ?? []

  let apiMatch = null
  try {
    const apiRows = await fetchEarnSilosForChain(chainKey)
    apiMatch = apiRows.find((row) => normalizeAddress(row?.siloAddress) === siloAddress) ?? null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[sync-liquidation-silos] earn lookup failed for ${chainKey}: ${message}`)
  }
  if (apiMatch) {
    console.log(`[sync-liquidation-silos] source=earn found ${chainKey}:${siloAddress}`)
  } else {
    console.warn(
      `[sync-liquidation-silos] source=rpc ${chainKey}:${siloAddress}; collecting directly from contracts via multicall`
    )
  }

  const refreshed = await refreshTargets(new Map([[chainKey, new Set([siloAddress])]]))
  const targetRows = (refreshed.get(chainKey) ?? []).filter(
    (row) => normalizeAddress(row.siloAddress) === siloAddress
  )
  if (targetRows.length === 0) {
    throw new Error(
      `Requested address is not a valid Silo market on ${chainKey}: ${siloAddress} (could not resolve silo config/data)`
    )
  }
  if (targetRows.length > 1) {
    throw new Error(`Duplicate Silo entry detected for ${chainKey}:${siloAddress}; refusing to write snapshot`)
  }
  const targetRow = targetRows[0]
  if (!targetRow?.siloConfigAddress || !targetRow?.siloConfig || !targetRow?.tokenAddress) {
    throw new Error(
      `Incomplete Silo data for ${chainKey}:${siloAddress} (missing config/token metadata); refusing to write snapshot`
    )
  }

  const siloId = Number(targetRow.siloId)
  const forceV3BySiloId = Number.isFinite(siloId) && siloId >= V3_SILO_ID_MIN
  const marketVersion = forceV3BySiloId || Boolean(apiMatch) ? 'v3' : 'legacy'
  const nextRow = { ...targetRow, marketVersion }

  const withoutTarget = current.filter((row) => normalizeAddress(row.siloAddress) !== siloAddress)
  const out = [...withoutTarget, nextRow]
  writeChainSnapshot(chainKey, CHAIN_ID_BY_KEY[chainKey], out)
  console.log(`[sync-liquidation-silos] add/refresh wrote target ${siloAddress} into ${chainKey} (${out.length} total)`)
  if (nextRow.marketVersion === 'legacy') {
    addToLegacyWhitelist(chainKey, siloAddress)
  }
}

function readLegacyWhitelistItems(whitelistPath) {
  if (!existsSync(whitelistPath)) return null
  const payload = JSON.parse(readFileSync(whitelistPath, 'utf8'))
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.silos)
      ? payload.silos
      : null
  if (!items) {
    throw new Error(`Invalid whitelist format in ${whitelistPath}`)
  }
  return items
}

function writeLegacyWhitelistItems(whitelistPath, items) {
  mkdirSync(dirname(whitelistPath), { recursive: true })
  writeFileSync(whitelistPath, `${JSON.stringify(items, null, 4)}\n`, 'utf8')
}

function addToLegacyWhitelist(chainKey, siloAddress) {
  const whitelistPath = join(legacyWhitelistDir, `legacy_whitelist_${chainKey}.json`)
  const items = readLegacyWhitelistItems(whitelistPath) ?? []
  const alreadyListed = items.some((entry) => normalizeAddress(entry) === siloAddress)
  if (alreadyListed) {
    console.log(`[sync-liquidation-silos] legacy whitelist already contains ${siloAddress} in ${whitelistPath}`)
    return
  }
  items.push(siloAddress)
  writeLegacyWhitelistItems(whitelistPath, items)
  console.log(
    `[sync-liquidation-silos] legacy whitelist added ${siloAddress} to ${whitelistPath} (${items.length} total)`
  )
}

function removeFromLegacyWhitelist(chainKey, siloAddress) {
  const whitelistPath = join(legacyWhitelistDir, `legacy_whitelist_${chainKey}.json`)
  if (!existsSync(whitelistPath)) {
    console.log(`[sync-liquidation-silos] legacy whitelist skip missing file: ${whitelistPath}`)
    return
  }
  const items = readLegacyWhitelistItems(whitelistPath)
  if (!items) return
  const kept = items.filter(
    (entry) => typeof entry === 'string' && normalizeAddress(entry) !== siloAddress
  )
  const removed = items.length - kept.length
  writeLegacyWhitelistItems(whitelistPath, kept)
  console.log(
    `[sync-liquidation-silos] legacy whitelist removed ${removed} entry/entries from ${whitelistPath} (kept ${kept.length})`
  )
}

function removeMarketFromChain(chainKey, siloAddress) {
  if (!chainKey || !CHAIN_ID_BY_KEY[chainKey]) {
    throw new Error(`Unsupported chainKey: ${chainKey}`)
  }
  if (!siloAddress) {
    throw new Error('remove requires a valid siloAddress')
  }

  const snapshot = loadSnapshotByChain()
  const current = snapshot.get(chainKey)?.silos ?? []
  const existing = current.find((row) => normalizeAddress(row.siloAddress) === siloAddress) ?? null
  const version = existing ? marketVersionOf(existing) : 'v3'
  const filtered = current.filter((row) => normalizeAddress(row.siloAddress) !== siloAddress)

  if (filtered.length !== current.length) {
    writeChainSnapshot(chainKey, CHAIN_ID_BY_KEY[chainKey], filtered)
    console.log(
      `[sync-liquidation-silos] remove wrote ${filtered.length} records for ${chainKey} (removed ${siloAddress})`
    )
  } else {
    console.log(
      `[sync-liquidation-silos] remove: ${siloAddress} not in ${chainKey} snapshot; treating as ${version}`
    )
  }

  // v3: durable blacklist so full refresh will not re-add. legacy: snapshot drop + whitelist only.
  if (version === 'legacy') {
    removeFromLegacyWhitelist(chainKey, siloAddress)
  } else {
    addToBlacklist(chainKey, siloAddress)
  }
}

function runRemoveSingle() {
  const chainKey = (getFlag('chainKey') || '').toLowerCase()
  const siloAddress = normalizeAddress(getFlag('siloAddress') || '')
  if (!chainKey || !CHAIN_ID_BY_KEY[chainKey]) {
    throw new Error('remove mode requires --chainKey=<supported-chain>')
  }
  if (!siloAddress) {
    throw new Error('remove mode requires --siloAddress=0x...')
  }
  removeMarketFromChain(chainKey, siloAddress)
}

function parseBlacklistConfig(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('blacklist mode requires valid JSON in --config or --configFile')
  }
  const markets = Array.isArray(parsed?.markets) ? parsed.markets : null
  if (!markets) {
    throw new Error('blacklist config must be { "markets": [ { "chainKey", "siloAddress" } ] }')
  }
  const out = []
  for (const entry of markets) {
    const chainKey = typeof entry?.chainKey === 'string' ? entry.chainKey.trim().toLowerCase() : ''
    const siloAddress = normalizeAddress(entry?.siloAddress || '')
    if (!chainKey || !CHAIN_ID_BY_KEY[chainKey]) {
      throw new Error(`Invalid or unsupported chainKey in blacklist config: ${entry?.chainKey}`)
    }
    if (!siloAddress) {
      throw new Error(`Invalid siloAddress in blacklist config for ${chainKey}`)
    }
    out.push({ chainKey, siloAddress })
  }
  if (out.length === 0) {
    throw new Error('blacklist config markets array is empty')
  }
  return out
}

function runBlacklistBatch() {
  const configFile = getFlag('configFile')
  const configRaw = getFlag('config')
  let raw = configRaw
  if (configFile) {
    raw = readFileSync(configFile, 'utf8')
  }
  if (!raw || !String(raw).trim()) {
    throw new Error('blacklist mode requires --config=<json> or --configFile=<path>')
  }
  const markets = parseBlacklistConfig(String(raw))
  for (const entry of markets) {
    removeMarketFromChain(entry.chainKey, entry.siloAddress)
  }
  console.log(`[sync-liquidation-silos] blacklist batch processed ${markets.length} market(s)`)
}

async function main() {
  if (mode === 'full') {
    await runFullRefresh()
    return
  }
  if (mode === 'add') {
    await runAddOrRefreshSingle()
    return
  }
  if (mode === 'remove') {
    runRemoveSingle()
    return
  }
  if (mode === 'blacklist') {
    runBlacklistBatch()
    return
  }
  throw new Error(`Unknown mode "${mode}". Use: full | add | remove | blacklist`)
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`[sync-liquidation-silos] ${error.message}`)
    if (error.stack) console.error(error.stack)
  } else {
    console.error(`[sync-liquidation-silos] ${String(error)}`)
  }
  process.exit(1)
})
