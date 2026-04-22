import { Contract, getAddress, type Provider } from 'ethers'
import pausableTargetProbeArtifact from '@/abis/PausableTargetProbe.json'
import { loadAbi } from '@/utils/loadAbi'
import { buildReadMulticallCall, executeReadMulticall } from '@/utils/readMulticall'

/**
 * `keccak256("PAUSER_ROLE")` — the role hash Silo-side AccessControl contracts grant to
 * accounts allowed to invoke `pause()`. We check if Global Pause itself holds it on every
 * tracked target that exposes AccessControl.
 */
export const GLOBAL_PAUSE_PAUSER_ROLE =
  '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a'

const probeAbi = loadAbi(pausableTargetProbeArtifact)

export type TargetAuthorityStatus =
  | { kind: 'authorized' }
  | { kind: 'pending-ownership' }
  /** Contract is role-based (AccessControl), Global Pause lacks `PAUSER_ROLE`. */
  | { kind: 'no-role' }
  /** Contract is ownership-based (Ownable[2Step]), Global Pause is neither owner nor pending owner. */
  | { kind: 'not-owner' }
  /** All probes reverted — we cannot classify the contract from the outside. */
  | { kind: 'unknown' }

export type TargetAuthorityMap = ReadonlyMap<string, TargetAuthorityStatus>

export type TargetAuthorityProbeResult = {
  /** `true`/`false` when `hasRole(PAUSER_ROLE, globalPause)` succeeded; `null` when the probe reverted. */
  hasRole: boolean | null
  /** Checksummed `owner()` return; `null` when the probe reverted. */
  owner: string | null
  /** Checksummed `pendingOwner()` return; `null` when the probe reverted. */
  pendingOwner: string | null
}

function toChecksumOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

function addressesEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Pure decision function: maps the three allow-failure multicall probes onto the final UI
 * status. Exported for unit testing — `fetchGlobalPauseTargetAuthority` is a thin wrapper.
 *
 * Priority: authorized (role or owner) > pending-ownership > no-role > not-owner > unknown.
 */
export function deriveTargetAuthorityStatus(
  probe: TargetAuthorityProbeResult,
  globalPauseAddress: string
): TargetAuthorityStatus {
  const { hasRole, owner, pendingOwner } = probe
  if (hasRole === true) return { kind: 'authorized' }
  if (addressesEqual(owner, globalPauseAddress)) return { kind: 'authorized' }
  if (addressesEqual(pendingOwner, globalPauseAddress)) return { kind: 'pending-ownership' }
  if (owner != null) return { kind: 'not-owner' }
  if (hasRole === false) return { kind: 'no-role' }
  return { kind: 'unknown' }
}

/**
 * Multicall-first: for every tracked contract we probe `hasRole(PAUSER_ROLE, globalPause)`,
 * `owner()` and `pendingOwner()` in a single batch. `allowFailure: true` per call so a
 * contract that doesn't implement a given interface just yields `null` instead of blowing up
 * the whole batch. Caller gets a map keyed by lower-cased address.
 */
export async function fetchGlobalPauseTargetAuthority(
  provider: Provider,
  globalPauseAddress: string,
  contracts: readonly string[]
): Promise<TargetAuthorityMap> {
  const out = new Map<string, TargetAuthorityStatus>()
  if (contracts.length === 0) return out

  const globalPause = getAddress(globalPauseAddress)

  type ProbeValue = boolean | string
  const calls = []
  const perContract: { address: string; checksummed: string }[] = []

  for (const raw of contracts) {
    let checksummed: string
    try {
      checksummed = getAddress(raw)
    } catch {
      /** Skip malformed entries — surface nothing in the authority map for them. */
      continue
    }
    perContract.push({ address: raw, checksummed })
    const targetContract = new Contract(checksummed, probeAbi, provider)
    calls.push(
      buildReadMulticallCall<ProbeValue>({
        target: checksummed,
        abi: probeAbi,
        functionName: 'hasRole',
        args: [GLOBAL_PAUSE_PAUSER_ROLE, globalPause],
        allowFailure: true,
        fallback: async () => Boolean(await targetContract.hasRole(GLOBAL_PAUSE_PAUSER_ROLE, globalPause)),
        decodeResult: (value) => Boolean(value),
      }),
      buildReadMulticallCall<ProbeValue>({
        target: checksummed,
        abi: probeAbi,
        functionName: 'owner',
        allowFailure: true,
        fallback: async () => String(await targetContract.owner()),
        decodeResult: (value) => String(value),
      }),
      buildReadMulticallCall<ProbeValue>({
        target: checksummed,
        abi: probeAbi,
        functionName: 'pendingOwner',
        allowFailure: true,
        fallback: async () => String(await targetContract.pendingOwner()),
        decodeResult: (value) => String(value),
      })
    )
  }

  const results = await executeReadMulticall<ProbeValue>(provider, calls, {
    debugLabel: 'globalPauseAuthority:targets',
  })

  for (let i = 0; i < perContract.length; i += 1) {
    const entry = perContract[i]!
    const hasRoleRaw = results[i * 3] as boolean | null | undefined
    const ownerRaw = results[i * 3 + 1] as string | null | undefined
    const pendingRaw = results[i * 3 + 2] as string | null | undefined

    const probe: TargetAuthorityProbeResult = {
      hasRole: typeof hasRoleRaw === 'boolean' ? hasRoleRaw : null,
      owner: toChecksumOrNull(ownerRaw),
      pendingOwner: toChecksumOrNull(pendingRaw),
    }
    out.set(entry.checksummed.toLowerCase(), deriveTargetAuthorityStatus(probe, globalPause))
  }

  return out
}
