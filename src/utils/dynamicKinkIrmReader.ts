import { getAddress, ZeroAddress, type Provider } from 'ethers'
import dynamicKinkArtifact from '@/abis/DynamicKinkModel.json'
import { loadAbi } from '@/utils/loadAbi'
import { parseManageableVersion } from '@/utils/manageableOracleReader'
import {
  type DynamicKinkIrmConfig,
  parseDynamicKinkIrmConfigFromEthers,
} from '@/utils/dynamicKinkIrmConfig'
import { buildReadMulticallCall, executeReadMulticall, type ReadMulticallCall } from '@/utils/readMulticall'

const dynamicKinkAbi = loadAbi(dynamicKinkArtifact)

export type DynamicKinkModelState = {
  k: bigint
  silo: string
}

export type DynamicKinkImmutableConfig = {
  timelock: number
  rcompCapPerSecond: bigint
}

export type DynamicKinkIrmReadState = {
  irmAddress: string
  versionString: string | null
  contractName: string | null
  isDynamicKinkModel: boolean
  owner: string | null
  pendingConfigExists: boolean
  currentConfig: DynamicKinkIrmConfig | null
  currentModelState: DynamicKinkModelState | null
  currentImmutable: DynamicKinkImmutableConfig | null
  pendingConfig: DynamicKinkIrmConfig | null
  /** Non-null if `getModelStateAndConfig(true)` was attempted and pending is meaningful. */
  pendingModelState: DynamicKinkModelState | null
  pendingImmutable: DynamicKinkImmutableConfig | null
  /**
   * When `pendingConfigExists`, this is the unix timestamp (seconds) at which the pending config
   * becomes the active on-chain config (end of timelock). Opaque when the slot fails.
   */
  activateConfigAt: bigint | null
  error: string | null
}

function decodeStateTuple(
  value: unknown
): { k: bigint; silo: string } | null {
  const t = value as { k?: unknown; silo?: unknown } & [unknown, unknown] | null
  if (t == null) return null
  const kRaw = 'k' in t && t.k != null ? t.k : t?.[0]
  const sRaw = 'silo' in t && t.silo != null ? t.silo : t?.[1]
  if (kRaw == null || sRaw == null) return null
  try {
    const k = BigInt(String(kRaw))
    return { k, silo: getAddress(String(sRaw)) }
  } catch {
    return null
  }
}

function decodeConfigTuple(value: unknown): DynamicKinkIrmConfig | null {
  return parseDynamicKinkIrmConfigFromEthers(value)
}

function decodeImmutableTuple(
  value: unknown
): DynamicKinkImmutableConfig | null {
  const t = value as
    | { timelock?: unknown; rcompCapPerSecond?: unknown }
    | [unknown, unknown]
    | null
  if (t == null) return null
  const tlock =
    t && typeof t === 'object' && 'timelock' in t ? t.timelock : Array.isArray(t) ? t[0] : null
  const rcomp =
    t && typeof t === 'object' && 'rcompCapPerSecond' in t
      ? t.rcompCapPerSecond
      : Array.isArray(t)
        ? t[1]
        : null
  if (tlock == null || rcomp == null) return null
  const timelock = Number(tlock)
  if (!Number.isFinite(timelock)) return null
  return {
    timelock,
    rcompCapPerSecond: BigInt(String(rcomp)),
  }
}

/**
 * Batched `VERSION` / `owner` / `pendingConfigExists` / `getModelStateAndConfig` for one IRM
 * contract (must be the DynamicKink **implementation** the silo points at).
 */
export async function readDynamicKinkIrmState(
  provider: Provider,
  irmAddressRaw: string
): Promise<DynamicKinkIrmReadState> {
  if (!irmAddressRaw || irmAddressRaw.toLowerCase() === ZeroAddress.toLowerCase()) {
    return {
      irmAddress: ZeroAddress,
      versionString: null,
      contractName: null,
      isDynamicKinkModel: false,
      owner: null,
      pendingConfigExists: false,
      currentConfig: null,
      currentModelState: null,
      currentImmutable: null,
      pendingConfig: null,
      pendingModelState: null,
      pendingImmutable: null,
      activateConfigAt: null,
      error: 'No interest rate model is configured for this silo.',
    }
  }
  const irmAddress = getAddress(irmAddressRaw)

  const versionCall = buildReadMulticallCall<string | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'VERSION',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'string' ? value : null),
  })
  const ownerCall = buildReadMulticallCall<string | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'owner',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'string' ? getAddress(value) : null),
  })
  const pendingFlagCall = buildReadMulticallCall<boolean | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'pendingConfigExists',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => (typeof value === 'boolean' ? value : null),
  })
  const currentBundleCall = buildReadMulticallCall<{
    state: unknown
    config: unknown
    immutable: unknown
  } | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'getModelStateAndConfig',
    args: [false],
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => {
      const v = value as readonly unknown[] | { state?: unknown; config?: unknown; immutableConfig?: unknown }
      if (Array.isArray(v) && v.length >= 3) {
        return { state: v[0], config: v[1], immutable: v[2] }
      }
      if (v && typeof v === 'object' && 'state' in v && 'config' in v) {
        return {
          state: (v as { state: unknown }).state,
          config: (v as { config: unknown }).config,
          immutable: (v as { immutableConfig?: unknown }).immutableConfig,
        }
      }
      return null
    },
  })
  const pendingBundleCall = buildReadMulticallCall<{
    state: unknown
    config: unknown
    immutable: unknown
  } | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'getModelStateAndConfig',
    args: [true],
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => {
      const v = value as readonly unknown[] | { state?: unknown; config?: unknown; immutableConfig?: unknown }
      if (Array.isArray(v) && v.length >= 3) {
        return { state: v[0], config: v[1], immutable: v[2] }
      }
      if (v && typeof v === 'object' && 'state' in v && 'config' in v) {
        return {
          state: (v as { state: unknown }).state,
          config: (v as { config: unknown }).config,
          immutable: (v as { immutableConfig?: unknown }).immutableConfig,
        }
      }
      return null
    },
  })
  const activateAtCall = buildReadMulticallCall<bigint | null>({
    target: irmAddress,
    abi: dynamicKinkAbi,
    functionName: 'activateConfigAt',
    allowFailure: true,
    fallback: async () => null,
    decodeResult: (value) => {
      if (value == null) return null
      try {
        return BigInt(String(value))
      } catch {
        return null
      }
    },
  })

  const results = (await executeReadMulticall(
    provider,
    [versionCall, ownerCall, pendingFlagCall, currentBundleCall, pendingBundleCall, activateAtCall] as unknown as ReadMulticallCall<unknown>[],
    { debugLabel: 'readDynamicKinkIrmState' }
  )) as [string | null, string | null, boolean | null, unknown, unknown, bigint | null]

  const [versionString, owner, pendingExistsRaw, currentRaw, pendingRaw, activateConfigAt] = results
  const parsed = parseManageableVersion(versionString)
  const isDynamicKinkModel = parsed.contractName === 'DynamicKinkModel'
  const pendingConfigExists = pendingExistsRaw === true

  const curB = currentRaw as { state: unknown; config: unknown; immutable: unknown } | null
  const pendB = pendingRaw as { state: unknown; config: unknown; immutable: unknown } | null

  return {
    irmAddress,
    versionString,
    contractName: parsed.contractName,
    isDynamicKinkModel,
    owner: owner,
    pendingConfigExists,
    currentConfig: curB ? decodeConfigTuple(curB.config) : null,
    currentModelState: curB ? decodeStateTuple(curB.state) : null,
    currentImmutable: curB ? decodeImmutableTuple(curB.immutable) : null,
    pendingConfig: pendB && pendingConfigExists ? decodeConfigTuple(pendB.config) : null,
    pendingModelState: pendB && pendingConfigExists ? decodeStateTuple(pendB.state) : null,
    pendingImmutable: pendB && pendingConfigExists ? decodeImmutableTuple(pendB.immutable) : null,
    activateConfigAt: activateConfigAt,
    error: null,
  }
}
