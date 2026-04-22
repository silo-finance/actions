import { Contract, getAddress, type Provider } from 'ethers'
import pausableTargetProbeArtifact from '@/abis/PausableTargetProbe.json'
import { GLOBAL_PAUSE_PAUSER_ROLE, type TargetAuthorityStatus } from '@/utils/globalPauseAuthority'
import { loadAbi } from '@/utils/loadAbi'
import {
  buildReadMulticallCall,
  executeReadMulticall,
  type ReadMulticallCall,
} from '@/utils/readMulticall'

/**
 * `keccak256("PAUSER_ROLE_ADMIN")` — Silo-side AccessControl hands this role to the accounts
 * that may grant `PAUSER_ROLE`. We probe its holders first when looking for someone who can
 * `grantRole(PAUSER_ROLE, globalPause)` on a target that rejected Global Pause.
 */
export const PAUSER_ROLE_ADMIN =
  '0xe0e65c783ac33ff1c5ccf4399c9185066773921d6f8d050bf80781603021f097' as const

/** OpenZeppelin `DEFAULT_ADMIN_ROLE` — root admin over every AccessControl role, so a holder can
 * also grant `PAUSER_ROLE_ADMIN`/`PAUSER_ROLE`. Fallback scanned only when `PAUSER_ROLE_ADMIN`
 * enumeration yields no actionable candidate.
 */
export const DEFAULT_ADMIN_ROLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/** Defensive cap on role holders consumed per role (Silo roles are expected to stay small;
 * this guards the UI against a pathologically large membership list that slipped past
 * governance). */
const ROLE_MEMBER_CAP = 64

const probeAbi = loadAbi(pausableTargetProbeArtifact)

/** Minimal Safe probe fragments — mirrors `ownerKind.ts` / `safeOwnerList.ts` exactly so the
 * Safe detection semantics stay identical to the vault flows. */
const SAFE_PROBE_ABI = [
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
] as const

export type RemediationAction =
  | { kind: 'transferOwnership' }
  | { kind: 'grantRole'; role: `0x${string}` }

export type RemediationMode =
  | { kind: 'direct' }
  | { kind: 'safe_as_wallet'; safeAddress: string }
  | { kind: 'safe_propose'; safeAddress: string }
  | { kind: 'denied' }

export type RemediationPlan = {
  target: string
  action: RemediationAction
  mode: RemediationMode
}

export type RemediationMap = ReadonlyMap<string, RemediationPlan>

/**
 * Enriched candidate describing a single potential remediator (owner of an ownership-based
 * target, or a role holder for a role-based target).
 */
export type CandidateStatus = {
  /** Checksummed address of the candidate. */
  address: string
  /** True when `getOwners()` probe succeeded and returned a non-empty owners list. */
  isSafe: boolean
  /** True when the connected account appears in the Safe's `getOwners()` list. */
  isSafeOwner: boolean
}

export type BulkPlan =
  | { kind: 'single_safe_batch'; safeAddress: string; items: RemediationPlan[] }
  | { kind: 'per_row' }
  | { kind: 'none' }

function eqAddr(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

function toChecksumOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

/**
 * Priority order:
 *   1. candidate equals connected account and is a Safe → `safe_as_wallet`
 *   2. candidate equals connected account (EOA)        → `direct`
 *   3. candidate is a Safe and connected account ∈ owners → `safe_propose`
 *
 * Returns the first match across the ordered candidate list; otherwise `denied`.
 */
export function pickRemediationMode(
  candidates: readonly CandidateStatus[],
  connectedAccount: string
): RemediationMode {
  const me = toChecksumOrNull(connectedAccount)
  if (!me) return { kind: 'denied' }

  for (const candidate of candidates) {
    if (eqAddr(candidate.address, me)) {
      if (candidate.isSafe) {
        return { kind: 'safe_as_wallet', safeAddress: candidate.address }
      }
      return { kind: 'direct' }
    }
    if (candidate.isSafe && candidate.isSafeOwner) {
      return { kind: 'safe_propose', safeAddress: candidate.address }
    }
  }
  return { kind: 'denied' }
}

/**
 * Maps a single target's authority status onto a `RemediationPlan`:
 *
 * - `not-owner` → `transferOwnership`, one candidate (`owner()`).
 * - `no-role`   → `grantRole`, candidates = holders of `PAUSER_ROLE_ADMIN` then `DEFAULT_ADMIN_ROLE`.
 * - anything else → `null` (caller should render nothing for that row).
 *
 * NOTE: `fetchGlobalPauseRemediationPlans` additionally considers role-based fallback for
 * hybrid (Ownable + AccessControl) targets whose status is `not-owner`. This helper stays
 * single-path for unit-test clarity; the merging is performed inside the fetcher.
 */
export function classifyRemediationForTarget(params: {
  target: string
  status: TargetAuthorityStatus
  candidates: readonly CandidateStatus[]
  connectedAccount: string
}): RemediationPlan | null {
  const { target, status, candidates, connectedAccount } = params
  if (status.kind === 'not-owner') {
    return {
      target,
      action: { kind: 'transferOwnership' },
      mode: pickRemediationMode(candidates, connectedAccount),
    }
  }
  if (status.kind === 'no-role') {
    return {
      target,
      action: { kind: 'grantRole', role: GLOBAL_PAUSE_PAUSER_ROLE as `0x${string}` },
      mode: pickRemediationMode(candidates, connectedAccount),
    }
  }
  return null
}

/**
 * Prefer the least-invasive actionable plan. `grantRole` only adds a permission; ownership
 * transfer changes the entire contract controller. So when both are actionable pick `grantRole`.
 * If the role plan is denied but ownership plan is actionable, fall through. If both are denied
 * or null, prefer the role plan (keeps UI framing consistent: AccessControl contracts usually
 * expose richer remediation affordances), otherwise ownership.
 */
export function preferRoleThenOwnership(
  role: RemediationPlan | null,
  ownership: RemediationPlan | null
): RemediationPlan | null {
  const roleActionable = role && role.mode.kind !== 'denied'
  if (roleActionable) return role
  const ownershipActionable = ownership && ownership.mode.kind !== 'denied'
  if (ownershipActionable) return ownership
  return role ?? ownership
}

/**
 * Bulk helper: if every actionable plan is `safe_propose` and they all share the same Safe,
 * we can wrap all remediation calls into a single Safe MultiSend proposal. Otherwise fall back
 * to per-row buttons (EOA direct, mixed Safes, or `safe_as_wallet` cases that cannot be
 * pre-signed by a proposer EOA via the Safe Transaction Service).
 */
export function groupRemediationForBulk(map: RemediationMap): BulkPlan {
  const actionable: RemediationPlan[] = []
  Array.from(map.values()).forEach((plan) => {
    if (plan.mode.kind !== 'denied') actionable.push(plan)
  })
  if (actionable.length === 0) return { kind: 'none' }

  const allSafePropose = actionable.every((p) => p.mode.kind === 'safe_propose')
  if (!allSafePropose) return { kind: 'per_row' }

  const firstSafe = (actionable[0]!.mode as { kind: 'safe_propose'; safeAddress: string }).safeAddress
  const everySameSafe = actionable.every(
    (p) => p.mode.kind === 'safe_propose' && eqAddr(p.mode.safeAddress, firstSafe)
  )
  if (!everySameSafe) return { kind: 'per_row' }

  return { kind: 'single_safe_batch', safeAddress: getAddress(firstSafe), items: actionable }
}

type TargetInput = { address: string; status: TargetAuthorityStatus }

type NormalizedTarget = {
  raw: string
  checksummed: string
  status: TargetAuthorityStatus
}

function normalizeTargets(targets: readonly TargetInput[]): NormalizedTarget[] {
  const out: NormalizedTarget[] = []
  for (const t of targets) {
    if (t.status.kind !== 'not-owner' && t.status.kind !== 'no-role') continue
    let checksummed: string
    try {
      checksummed = getAddress(t.address)
    } catch {
      continue
    }
    out.push({ raw: t.address, checksummed, status: t.status })
  }
  return out
}

function decodeAddressArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    const addr = toChecksumOrNull(v)
    if (addr) out.push(addr)
    if (out.length >= ROLE_MEMBER_CAP) break
  }
  return out
}

/**
 * Fetches remediation plans for every target whose current authority status is `not-owner` or
 * `no-role`. Two multicall batches with `allowFailure: true`:
 *
 *   A) per-target probes — ALWAYS `owner()` + `getRoleMembers(PAUSER_ROLE_ADMIN)` +
 *      `getRoleMembers(DEFAULT_ADMIN_ROLE)` for every target. Dual-path is required because Silo
 *      v2 contracts are hybrid (Ownable + AccessControl): `owner()` succeeds, yielding status
 *      `not-owner`, but pausing still honors `PAUSER_ROLE`. Without role probes on `not-owner`
 *      targets we would miss `grantRole` remediation paths where the pauser-role admin is a Safe
 *      the connected EOA co-signs.
 *   B) per-unique-candidate Safe probe — `getThreshold()` + `getOwners()`.
 *
 * For each target we build both an ownership plan (from `owner()`) and a role plan (from
 * `PAUSER_ROLE_ADMIN` then `DEFAULT_ADMIN_ROLE` holders), then prefer the role plan if it's
 * actionable (less invasive than transferring ownership of the entire contract).
 */
export async function fetchGlobalPauseRemediationPlans(
  provider: Provider,
  connectedAccount: string,
  targets: readonly TargetInput[]
): Promise<RemediationMap> {
  const out = new Map<string, RemediationPlan>()
  const normalized = normalizeTargets(targets)
  if (normalized.length === 0) return out

  // --- Batch A: per-target probes (owner + role members × 2). Dual-path for every target. ---
  type BatchAValue = string | string[]
  type BatchAEntry = {
    target: NormalizedTarget
    kind: 'owner' | 'rolePauserAdmin' | 'roleDefaultAdmin'
    index: number
  }
  const batchA: BatchAEntry[] = []
  const batchACalls: ReadMulticallCall<BatchAValue>[] = []

  for (const target of normalized) {
    const probe = new Contract(target.checksummed, probeAbi, provider)

    batchA.push({ target, kind: 'owner', index: batchACalls.length })
    batchACalls.push(
      buildReadMulticallCall<BatchAValue>({
        target: target.checksummed,
        abi: probeAbi,
        functionName: 'owner',
        allowFailure: true,
        fallback: async () => String(await probe.owner()),
        decodeResult: (value) => String(value),
      })
    )

    batchA.push({ target, kind: 'rolePauserAdmin', index: batchACalls.length })
    batchACalls.push(
      buildReadMulticallCall<BatchAValue>({
        target: target.checksummed,
        abi: probeAbi,
        functionName: 'getRoleMembers',
        args: [PAUSER_ROLE_ADMIN],
        allowFailure: true,
        fallback: async () => {
          const raw = (await probe.getRoleMembers(PAUSER_ROLE_ADMIN)) as unknown
          return Array.isArray(raw) ? raw.map((v) => String(v)) : []
        },
        decodeResult: (value) => decodeAddressArray(value),
      })
    )

    batchA.push({ target, kind: 'roleDefaultAdmin', index: batchACalls.length })
    batchACalls.push(
      buildReadMulticallCall<BatchAValue>({
        target: target.checksummed,
        abi: probeAbi,
        functionName: 'getRoleMembers',
        args: [DEFAULT_ADMIN_ROLE],
        allowFailure: true,
        fallback: async () => {
          const raw = (await probe.getRoleMembers(DEFAULT_ADMIN_ROLE)) as unknown
          return Array.isArray(raw) ? raw.map((v) => String(v)) : []
        },
        decodeResult: (value) => decodeAddressArray(value),
      })
    )
  }

  const batchAResults = await executeReadMulticall<BatchAValue>(provider, batchACalls, {
    debugLabel: 'globalPauseRemediation:batchA',
  })

  const ownerByTarget = new Map<string, string | null>()
  const roleHoldersByTarget = new Map<
    string,
    { pauserAdmin: string[]; defaultAdmin: string[] }
  >()

  for (const entry of batchA) {
    const raw = batchAResults[entry.index]
    if (entry.kind === 'owner') {
      ownerByTarget.set(entry.target.checksummed, toChecksumOrNull(raw))
      continue
    }
    const prev = roleHoldersByTarget.get(entry.target.checksummed) ?? {
      pauserAdmin: [],
      defaultAdmin: [],
    }
    const holders = decodeAddressArray(raw)
    if (entry.kind === 'rolePauserAdmin') prev.pauserAdmin = holders
    else prev.defaultAdmin = holders
    roleHoldersByTarget.set(entry.target.checksummed, prev)
  }

  // --- Batch B: Safe detection + membership per unique candidate ---
  const candidateSet = new Set<string>()
  Array.from(ownerByTarget.values()).forEach((owner) => {
    if (owner) candidateSet.add(owner)
  })
  Array.from(roleHoldersByTarget.values()).forEach((holders) => {
    for (const addr of holders.pauserAdmin) candidateSet.add(addr)
    for (const addr of holders.defaultAdmin) candidateSet.add(addr)
  })

  const candidateAddresses = Array.from(candidateSet)
  const meChecksum = toChecksumOrNull(connectedAccount)

  type BatchBValue = bigint | string[]
  type BatchBEntry = {
    address: string
    thresholdIndex: number
    ownersIndex: number
  }
  const batchB: BatchBEntry[] = []
  const batchBCalls: ReadMulticallCall<BatchBValue>[] = []
  for (const address of candidateAddresses) {
    const safe = new Contract(address, SAFE_PROBE_ABI, provider)
    const thresholdIndex = batchBCalls.length
    batchBCalls.push(
      buildReadMulticallCall<BatchBValue>({
        target: address,
        abi: SAFE_PROBE_ABI,
        functionName: 'getThreshold',
        allowFailure: true,
        fallback: async () => BigInt(await safe.getThreshold()),
        decodeResult: (value) => BigInt(value as bigint | number | string),
      })
    )
    const ownersIndex = batchBCalls.length
    batchBCalls.push(
      buildReadMulticallCall<BatchBValue>({
        target: address,
        abi: SAFE_PROBE_ABI,
        functionName: 'getOwners',
        allowFailure: true,
        fallback: async () => {
          const raw = (await safe.getOwners()) as unknown
          return Array.isArray(raw) ? raw.map((v) => String(v)) : []
        },
        decodeResult: (value) => {
          if (!Array.isArray(value)) return []
          return value.map((v) => String(v))
        },
      })
    )
    batchB.push({ address, thresholdIndex, ownersIndex })
  }

  const batchBResults = batchBCalls.length
    ? await executeReadMulticall<BatchBValue>(provider, batchBCalls, {
        debugLabel: 'globalPauseRemediation:batchB',
      })
    : []

  const candidateInfo = new Map<string, CandidateStatus>()
  for (const entry of batchB) {
    const threshold = batchBResults[entry.thresholdIndex]
    const owners = batchBResults[entry.ownersIndex]
    const thresholdOk = typeof threshold === 'bigint' && threshold > BigInt(0)
    const ownerList: string[] = Array.isArray(owners)
      ? (owners as string[]).map((o) => toChecksumOrNull(o) ?? '').filter((o) => o !== '')
      : []
    const isSafe = thresholdOk && ownerList.length > 0
    const isSafeOwner =
      isSafe && meChecksum != null && ownerList.some((o) => eqAddr(o, meChecksum))
    candidateInfo.set(entry.address, { address: entry.address, isSafe, isSafeOwner })
  }

  let actionableCount = 0
  let roleWins = 0
  let ownershipWins = 0
  let deniedCount = 0

  for (const target of normalized) {
    const owner = ownerByTarget.get(target.checksummed)
    const holders = roleHoldersByTarget.get(target.checksummed)

    let ownershipPlan: RemediationPlan | null = null
    if (owner) {
      const info = candidateInfo.get(owner) ?? {
        address: owner,
        isSafe: false,
        isSafeOwner: false,
      }
      ownershipPlan = {
        target: target.checksummed,
        action: { kind: 'transferOwnership' },
        mode: pickRemediationMode([info], connectedAccount),
      }
    }

    let rolePlan: RemediationPlan | null = null
    const roleCandidates: CandidateStatus[] = []
    if (holders) {
      for (const addr of holders.pauserAdmin) {
        roleCandidates.push(
          candidateInfo.get(addr) ?? { address: addr, isSafe: false, isSafeOwner: false }
        )
      }
      for (const addr of holders.defaultAdmin) {
        roleCandidates.push(
          candidateInfo.get(addr) ?? { address: addr, isSafe: false, isSafeOwner: false }
        )
      }
    }
    if (roleCandidates.length > 0) {
      rolePlan = {
        target: target.checksummed,
        action: { kind: 'grantRole', role: GLOBAL_PAUSE_PAUSER_ROLE as `0x${string}` },
        mode: pickRemediationMode(roleCandidates, connectedAccount),
      }
    }

    const chosen = preferRoleThenOwnership(rolePlan, ownershipPlan)
    if (!chosen) continue

    if (chosen.mode.kind === 'denied') deniedCount += 1
    else {
      actionableCount += 1
      if (chosen.action.kind === 'grantRole') roleWins += 1
      else ownershipWins += 1
    }

    out.set(target.checksummed.toLowerCase(), chosen)
  }

  if (typeof console !== 'undefined') {
    console.debug(
      '[globalPauseRemediation] summary',
      JSON.stringify({
        targets: normalized.length,
        candidates: candidateAddresses.length,
        actionable: actionableCount,
        denied: deniedCount,
        roleWins,
        ownershipWins,
      })
    )
  }

  return out
}
