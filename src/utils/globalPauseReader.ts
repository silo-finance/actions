import { Contract, getAddress, type Provider } from 'ethers'
import globalPauseArtifact from '@/abis/GlobalPause.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall } from '@/utils/readMulticall'

const globalPauseAbi = loadAbi(globalPauseArtifact)

export type ContractPauseStatus = {
  address: string
  isPaused: boolean
}

export type GlobalPauseOverview = {
  owner: string
  allContracts: string[]
  authorizedToPause: string[]
  statuses: ContractPauseStatus[]
  /**
   * True when the connected wallet may run `pauseAll` / `unpauseAll`. The check is
   * `isSigner(account) || account ∈ authorizedToPause || account === owner`.
   * `null` when no wallet is connected (UI should render "connect wallet" copy, not "denied").
   */
  canPauseAll: boolean | null
}

type RawPauseStatus = {
  contractAddress: string
  isPaused: boolean
}

function normalizeAddressList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    try {
      out.push(getAddress(String(item)))
    } catch {
      // skip malformed entries instead of breaking the whole panel
    }
  }
  return out
}

function normalizePauseStatuses(raw: unknown): ContractPauseStatus[] {
  if (!Array.isArray(raw)) return []
  const out: ContractPauseStatus[] = []
  for (const entry of raw as RawPauseStatus[]) {
    if (!entry) continue
    try {
      out.push({
        address: getAddress(String(entry.contractAddress)),
        isPaused: Boolean(entry.isPaused),
      })
    } catch {
      // ignore malformed entries
    }
  }
  return out
}

function addressesEqual(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Single multicall batch for the Global Pause section. Bundles the permission check
 * (`isSigner(account)`) together with the other reads so we do not issue a second
 * RPC round-trip just for the "can this wallet pause" flag.
 */
export async function fetchGlobalPauseOverview(
  provider: Provider,
  globalPauseAddress: string,
  connectedAccount: string | null
): Promise<GlobalPauseOverview> {
  const target = getAddress(globalPauseAddress)
  const contract = new Contract(target, globalPauseAbi, provider)
  const accountNorm = connectedAccount ? (() => {
    try {
      return getAddress(connectedAccount)
    } catch {
      return null
    }
  })() : null

  const calls = [
    buildReadMulticallCall({
      target,
      abi: globalPauseAbi,
      functionName: 'owner',
      fallback: async () => contract.owner(),
      decodeResult: (value) => String(value),
    }),
    buildReadMulticallCall({
      target,
      abi: globalPauseAbi,
      functionName: 'allContracts',
      fallback: async () => contract.allContracts(),
      decodeResult: (value) => value as unknown,
    }),
    buildReadMulticallCall({
      target,
      abi: globalPauseAbi,
      functionName: 'authorizedToPause',
      fallback: async () => contract.authorizedToPause(),
      decodeResult: (value) => value as unknown,
    }),
    buildReadMulticallCall({
      target,
      abi: globalPauseAbi,
      functionName: 'getAllContractsPauseStatus',
      fallback: async () => contract.getAllContractsPauseStatus(),
      decodeResult: (value) => value as unknown,
    }),
  ]

  if (accountNorm) {
    calls.push(
      buildReadMulticallCall({
        target,
        abi: globalPauseAbi,
        functionName: 'isSigner',
        args: [accountNorm],
        /** `isSigner` may revert on legacy deployments — tolerate a failure, we still have owner/authorized lists. */
        allowFailure: true,
        fallback: async () => {
          try {
            return Boolean(await contract.isSigner(accountNorm))
          } catch {
            return false
          }
        },
        decodeResult: (value) => Boolean(value),
      })
    )
  }

  const results = await executeReadMulticall(provider, calls, {
    debugLabel: 'globalPauseReader:overview',
  })

  const ownerRaw = String(results[0] ?? '')
  const owner = (() => {
    try {
      return getAddress(ownerRaw)
    } catch {
      return ownerRaw
    }
  })()
  const allContracts = normalizeAddressList(results[1])
  const authorizedToPause = normalizeAddressList(results[2])
  const statuses = normalizePauseStatuses(results[3])
  const isSignerResult = accountNorm ? Boolean(results[4]) : null

  let canPauseAll: boolean | null = null
  if (accountNorm) {
    const inAuthorized = authorizedToPause.some((a) => addressesEqual(a, accountNorm))
    const isOwner = addressesEqual(owner, accountNorm)
    canPauseAll = Boolean(isSignerResult) || inAuthorized || isOwner
  }

  return {
    owner,
    allContracts,
    authorizedToPause,
    statuses,
    canPauseAll,
  }
}
