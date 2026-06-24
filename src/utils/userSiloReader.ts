import { getAddress, ZeroAddress, formatUnits, type Provider } from 'ethers'
import siloArtifact from '@/abis/Silo.json'
import siloConfigArtifact from '@/abis/SiloConfig.json'
import siloLensArtifact from '@/abis/ISiloLens.json'
import erc20Artifact from '@/abis/ERC20.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall, type ReadMulticallCall } from '@/utils/readMulticall'
import { getSiloLensAddressForChain } from '@/utils/liquidationRpc'

const siloAbi = loadAbi(siloArtifact)
const siloConfigAbi = loadAbi(siloConfigArtifact)
const siloLensAbi = loadAbi(siloLensArtifact)
const erc20Abi = loadAbi(erc20Artifact)

/** `ISilo.AssetType` enum — Protected is the non-borrowable deposit bucket. */
const ASSET_TYPE_PROTECTED = 0
/** `ISilo.CollateralType` enum used by `previewRedeem(uint256,uint8)`. */
const COLLATERAL_TYPE_PROTECTED = 0
const COLLATERAL_TYPE_COLLATERAL = 1

export type UserRole = 'BORROWER' | 'LENDER' | 'NO_POSITION'

/** Pool-level totals for one silo, in underlying-asset units (not user-specific). */
export type SiloMarketTotals = {
  totalAssets: bigint
  totalDebt: bigint
  totalProtected: bigint
}

/** A single user's position in one silo, converted to underlying-asset units. */
export type SiloUserPositionAmounts = {
  protectedAssets: bigint
  collateralAssets: bigint
  debtAssets: bigint
}

export type SiloUserData = {
  silo: string
  token: string
  symbol: string | null
  decimals: number
  marketTotals: SiloMarketTotals
  userPosition: SiloUserPositionAmounts
}

/** Subset of `ConfigData` relevant to the solvency view (collateral or debt side). */
export type SolvencyConfigSummary = {
  silo: string
  token: string
  lt: bigint
  liquidationTargetLtv: bigint
  maxLtv: bigint
}

export type UserSiloPosition = {
  siloConfig: string
  siloId: number | null
  user: string
  role: UserRole
  isSolvent: boolean | null
  /** WAD (1e18 = 100%). `null` when the Silo Lens is unavailable on this chain. */
  ltv: bigint | null
  /** WAD; Silo Lens returns `0` when the user has no debt. */
  lt: bigint | null
  collateralConfig: SolvencyConfigSummary | null
  debtConfig: SolvencyConfigSummary | null
  silos: [SiloUserData, SiloUserData]
}

type SiloConfigShape = {
  token: string
  protectedShareToken: string
}

function toAddress(value: unknown): string {
  return typeof value === 'string' ? getAddress(value) : ZeroAddress
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' || typeof value === 'string') {
    try {
      return BigInt(value)
    } catch {
      return BigInt(0)
    }
  }
  return BigInt(0)
}

function summarizeSolvencyConfig(raw: Record<string, unknown>): SolvencyConfigSummary {
  return {
    silo: toAddress(raw?.silo),
    token: toAddress(raw?.token),
    lt: toBigInt(raw?.lt),
    liquidationTargetLtv: toBigInt(raw?.liquidationTargetLtv),
    maxLtv: toBigInt(raw?.maxLtv),
  }
}

/** Formats a WAD ratio (1e18 = 100%) as a percentage string for display. */
export function formatWadPercent(wad: bigint | null, maxFractionDigits = 2): string {
  if (wad == null) return '—'
  const pct = Number(formatUnits(wad, 18)) * 100
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits })}%`
}

/**
 * Reads everything the `/user` page needs for one market (silo0 + silo1) and one user.
 *
 * Reads are batched into Multicall3 rounds. Three rounds are required by data dependencies, not by
 * choice: round 1 discovers share-token + asset addresses, round 2 reads share balances at those
 * addresses, round 3 converts the freshly-read protected shares into underlying assets via
 * `previewRedeem`. Each round is a single `executeReadMulticall`, and rounds 2/3 are skipped when
 * there is nothing to read.
 */
export async function readUserSiloPosition(
  provider: Provider,
  chainId: number,
  siloConfig: string,
  silos: readonly [string, string],
  userAddress: string
): Promise<UserSiloPosition> {
  const config = getAddress(siloConfig)
  const silo0 = getAddress(silos[0])
  const silo1 = getAddress(silos[1])
  const user = getAddress(userAddress)
  const siloList: [string, string] = [silo0, silo1]

  const lensAddress = await getSiloLensAddressForChain(chainId)

  // Round 1 — config discovery + all reads that only need (silo, user) addresses we already have.
  const round1: ReadMulticallCall<unknown>[] = []
  const idx: Record<string, number> = {}
  const push = (key: string, call: ReadMulticallCall<unknown>) => {
    idx[key] = round1.length
    round1.push(call)
  }

  push(
    'siloId',
    buildReadMulticallCall<number | null>({
      target: config,
      abi: siloConfigAbi,
      functionName: 'SILO_ID',
      allowFailure: true,
      fallback: async () => null,
      decodeResult: (value) => {
        const n = Number(value as bigint | number | string)
        return Number.isFinite(n) ? n : null
      },
    }) as ReadMulticallCall<unknown>
  )

  siloList.forEach((silo, i) => {
    push(
      `config${i}`,
      buildReadMulticallCall<SiloConfigShape | null>({
        target: config,
        abi: siloConfigAbi,
        functionName: 'getConfig',
        args: [silo],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => {
          const cfg = value as Record<string, unknown>
          return { token: toAddress(cfg?.token), protectedShareToken: toAddress(cfg?.protectedShareToken) }
        },
      }) as ReadMulticallCall<unknown>
    )
  })

  push(
    'solvency',
    buildReadMulticallCall<{ collateral: SolvencyConfigSummary; debt: SolvencyConfigSummary } | null>({
      target: config,
      abi: siloConfigAbi,
      functionName: 'getConfigsForSolvency',
      args: [user],
      allowFailure: true,
      fallback: async () => null,
      decodeResult: (value) => {
        const tuple = value as [Record<string, unknown>, Record<string, unknown>]
        return { collateral: summarizeSolvencyConfig(tuple[0]), debt: summarizeSolvencyConfig(tuple[1]) }
      },
    }) as ReadMulticallCall<unknown>
  )

  push(
    'isSolvent',
    buildReadMulticallCall<boolean | null>({
      target: silo0,
      abi: siloAbi,
      functionName: 'isSolvent',
      args: [user],
      allowFailure: true,
      fallback: async () => null,
      decodeResult: (value) => Boolean(value),
    }) as ReadMulticallCall<unknown>
  )

  if (lensAddress) {
    push(
      'ltv',
      buildReadMulticallCall<bigint | null>({
        target: lensAddress,
        abi: siloLensAbi,
        functionName: 'getUserLTV',
        args: [silo0, user],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
    push(
      'lt',
      buildReadMulticallCall<bigint | null>({
        target: lensAddress,
        abi: siloLensAbi,
        functionName: 'getUserLT',
        args: [silo0, user],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
  }

  siloList.forEach((silo, i) => {
    push(
      `totalAssets${i}`,
      buildReadMulticallCall<bigint | null>({
        target: silo,
        abi: siloAbi,
        functionName: 'totalAssets',
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
    push(
      `totalDebt${i}`,
      buildReadMulticallCall<bigint | null>({
        target: silo,
        abi: siloAbi,
        functionName: 'getDebtAssets',
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
    push(
      `totalProtected${i}`,
      buildReadMulticallCall<bigint | null>({
        target: silo,
        abi: siloAbi,
        functionName: 'getTotalAssetsStorage',
        args: [ASSET_TYPE_PROTECTED],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
    push(
      `collateralShares${i}`,
      buildReadMulticallCall<bigint | null>({
        target: silo,
        abi: siloAbi,
        functionName: 'balanceOf',
        args: [user],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
    push(
      `debtAssets${i}`,
      buildReadMulticallCall<bigint | null>({
        target: silo,
        abi: siloAbi,
        functionName: 'maxRepay',
        args: [user],
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => toBigInt(value),
      }) as ReadMulticallCall<unknown>
    )
  })

  const r1 = await executeReadMulticall(provider, round1, { chainId, debugLabel: 'readUserSiloPosition.discover' })
  const get = <T>(key: string): T | null => (idx[key] == null ? null : (r1[idx[key]] as T | null))

  const siloId = get<number>('siloId')
  const solvency = get<{ collateral: SolvencyConfigSummary; debt: SolvencyConfigSummary }>('solvency')
  const isSolvent = get<boolean>('isSolvent')
  const ltv = get<bigint>('ltv')
  const lt = get<bigint>('lt')

  const configs: (SiloConfigShape | null)[] = [get<SiloConfigShape>('config0'), get<SiloConfigShape>('config1')]
  const collateralShares: bigint[] = [
    get<bigint>('collateralShares0') ?? BigInt(0),
    get<bigint>('collateralShares1') ?? BigInt(0),
  ]
  const debtAssets: bigint[] = [get<bigint>('debtAssets0') ?? BigInt(0), get<bigint>('debtAssets1') ?? BigInt(0)]
  const marketTotals: SiloMarketTotals[] = siloList.map((_, i) => ({
    totalAssets: get<bigint>(`totalAssets${i}`) ?? BigInt(0),
    totalDebt: get<bigint>(`totalDebt${i}`) ?? BigInt(0),
    totalProtected: get<bigint>(`totalProtected${i}`) ?? BigInt(0),
  }))

  // Round 2 — reads that need addresses discovered in round 1 (protected shares, token metadata,
  // collateral assets). Token metadata is deduplicated across the two silos.
  const tokens = siloList.map((_, i) => configs[i]?.token ?? ZeroAddress)
  const uniqueTokens = Array.from(new Set(tokens.filter((t) => t !== ZeroAddress)))
  const round2: ReadMulticallCall<unknown>[] = []
  const idx2: Record<string, number> = {}
  const push2 = (key: string, call: ReadMulticallCall<unknown>) => {
    idx2[key] = round2.length
    round2.push(call)
  }

  siloList.forEach((silo, i) => {
    const protectedShareToken = configs[i]?.protectedShareToken ?? ZeroAddress
    if (protectedShareToken !== ZeroAddress) {
      push2(
        `protectedShares${i}`,
        buildReadMulticallCall<bigint | null>({
          target: protectedShareToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [user],
          allowFailure: true,
          fallback: async () => null,
          decodeResult: (value) => toBigInt(value),
        }) as ReadMulticallCall<unknown>
      )
    }
    if (collateralShares[i]! > BigInt(0)) {
      push2(
        `collateralAssets${i}`,
        buildReadMulticallCall<bigint | null>({
          target: silo,
          abi: siloAbi,
          functionName: 'previewRedeem(uint256,uint8)',
          args: [collateralShares[i], COLLATERAL_TYPE_COLLATERAL],
          allowFailure: true,
          fallback: async () => null,
          decodeResult: (value) => toBigInt(value),
        }) as ReadMulticallCall<unknown>
      )
    }
  })

  uniqueTokens.forEach((token) => {
    push2(
      `decimals:${token.toLowerCase()}`,
      buildReadMulticallCall<number | null>({
        target: token,
        abi: erc20Abi,
        functionName: 'decimals',
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => {
          const n = Number(value as bigint | number)
          return Number.isFinite(n) ? n : null
        },
      }) as ReadMulticallCall<unknown>
    )
    push2(
      `symbol:${token.toLowerCase()}`,
      buildReadMulticallCall<string | null>({
        target: token,
        abi: erc20Abi,
        functionName: 'symbol',
        allowFailure: true,
        fallback: async () => null,
        decodeResult: (value) => (typeof value === 'string' ? value : null),
      }) as ReadMulticallCall<unknown>
    )
  })

  const r2 = round2.length
    ? await executeReadMulticall(provider, round2, { chainId, debugLabel: 'readUserSiloPosition.balances' })
    : []
  const get2 = <T>(key: string): T | null => (idx2[key] == null ? null : (r2[idx2[key]] as T | null))

  const protectedShares: bigint[] = [
    get2<bigint>('protectedShares0') ?? BigInt(0),
    get2<bigint>('protectedShares1') ?? BigInt(0),
  ]
  const collateralAssets: bigint[] = [
    get2<bigint>('collateralAssets0') ?? BigInt(0),
    get2<bigint>('collateralAssets1') ?? BigInt(0),
  ]
  const decimalsByToken = new Map<string, number>()
  const symbolByToken = new Map<string, string | null>()
  uniqueTokens.forEach((token) => {
    decimalsByToken.set(token.toLowerCase(), get2<number>(`decimals:${token.toLowerCase()}`) ?? 18)
    symbolByToken.set(token.toLowerCase(), get2<string>(`symbol:${token.toLowerCase()}`) ?? null)
  })

  // Round 3 — convert protected shares to underlying. Skipped entirely when no protected shares.
  const protectedAssets: bigint[] = [BigInt(0), BigInt(0)]
  const round3: ReadMulticallCall<unknown>[] = []
  const idx3: Record<string, number> = {}
  siloList.forEach((silo, i) => {
    if (protectedShares[i]! > BigInt(0)) {
      idx3[`protectedAssets${i}`] = round3.length
      round3.push(
        buildReadMulticallCall<bigint | null>({
          target: silo,
          abi: siloAbi,
          functionName: 'previewRedeem(uint256,uint8)',
          args: [protectedShares[i], COLLATERAL_TYPE_PROTECTED],
          allowFailure: true,
          fallback: async () => null,
          decodeResult: (value) => toBigInt(value),
        }) as ReadMulticallCall<unknown>
      )
    }
  })
  if (round3.length) {
    const r3 = await executeReadMulticall(provider, round3, { chainId, debugLabel: 'readUserSiloPosition.protected' })
    siloList.forEach((_, i) => {
      const at = idx3[`protectedAssets${i}`]
      if (at != null) protectedAssets[i] = (r3[at] as bigint | null) ?? BigInt(0)
    })
  }

  const siloData = siloList.map((silo, i): SiloUserData => {
    const token = tokens[i]!
    const tokenKey = token.toLowerCase()
    return {
      silo,
      token,
      symbol: token === ZeroAddress ? null : (symbolByToken.get(tokenKey) ?? null),
      decimals: decimalsByToken.get(tokenKey) ?? 18,
      marketTotals: marketTotals[i]!,
      userPosition: {
        protectedAssets: protectedAssets[i]!,
        collateralAssets: collateralAssets[i]!,
        debtAssets: debtAssets[i]!,
      },
    }
  }) as [SiloUserData, SiloUserData]

  const hasDebt = debtAssets.some((d) => d > BigInt(0))
  const hasDeposit = siloData.some(
    (s) => s.userPosition.protectedAssets > BigInt(0) || s.userPosition.collateralAssets > BigInt(0)
  )
  const role: UserRole = hasDebt ? 'BORROWER' : hasDeposit ? 'LENDER' : 'NO_POSITION'

  const collateralConfig =
    solvency && solvency.collateral.silo !== ZeroAddress ? solvency.collateral : null
  const debtConfig = solvency && solvency.debt.silo !== ZeroAddress ? solvency.debt : null

  return {
    siloConfig: config,
    siloId,
    user,
    role,
    isSolvent,
    ltv,
    lt,
    collateralConfig,
    debtConfig,
    silos: siloData,
  }
}
