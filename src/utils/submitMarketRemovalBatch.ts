import { getAddress, Interface, type Provider, type Signer } from 'ethers'
import siloVaultArtifact from '@/abis/SiloVault.json'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { getExplorerTxUrl } from '@/utils/networks'
import { loadAbi } from '@/utils/loadAbi'
import type { OwnerKind } from '@/utils/ownerKind'
import {
  proposeReallocateRemoveWithdrawQueueViaSafe,
  vaultCalldatasToTargetedCalls,
} from '@/utils/reallocateRemoveWithdrawMarket'
import { getSafeWalletQueueUrl } from '@/utils/safeAppLinks'
import { isUserRejectionError, toUserErrorMessage } from '@/utils/rpcErrors'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import {
  classifyAllocatorVaultAction,
  classifyOwnerOrCuratorVaultAction,
  type VaultActionAuthority,
} from '@/utils/vaultActionAuthority'
import { assertVaultCallSucceeds, describeVaultRevert } from '@/utils/vaultCallRevert'
import { executeVaultCallsFromSigner, sendSafeWalletBatch, type TargetedCall } from '@/utils/vaultMulticall'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

const siloVaultAbi = loadAbi(siloVaultArtifact)
const vaultIface = new Interface(siloVaultAbi)

const Z = BigInt(0)
const CAP_ARG_ZERO = BigInt(0)

const SAFE_TX_ORIGIN = 'Silo Actions: submit market removal (submitCap 0 + submitMarketRemoval)'
const UPDATE_WITHDRAW_QUEUE_SAFE_TX_ORIGIN = 'Silo Actions: update withdraw queue (updateWithdrawQueue)'

export const SUBMIT_MARKET_REMOVAL_SECOND_STEP =
  'After the vault timelock elapses, the second step is updateWithdrawQueue, started from Finalize pending removals at the top of this queue.'

export const FINALIZE_REMOVAL_ELAPSED_HINT =
  'Timelock elapsed. Start Finalize pending removals above to call updateWithdrawQueue.'

export const UPDATE_WITHDRAW_QUEUE_READY_EMPTY =
  'Timelock elapsed. Vault supply is zero. Ready to remove.'

export const UPDATE_WITHDRAW_QUEUE_READY_WITH_SUPPLY =
  'Timelock elapsed. The vault still has supply here. updateWithdrawQueue will remove the market and change the vault price per share.'

export type SubmitMarketRemovalDisabledReason =
  | 'not_enabled'
  | 'pending_cap'
  | 'timelock_running'

/**
 * Two eligible paths per market:
 *  - `submit`   — market still has cap / no pending removal: needs `submitCap(0)` + `submitMarketRemoval`.
 *  - `finalize` — `removableAt != 0` and the forced-removal timelock has elapsed: ready to drop
 *                 from the withdraw queue via `updateWithdrawQueue(newIndexes)` without any timelock.
 */
export type MarketRemovalMode =
  | { kind: 'submit' }
  | { kind: 'finalize' }
  | { kind: 'ineligible'; reasons: SubmitMarketRemovalDisabledReason[] }

/**
 * Classifies a market against the on-chain preconditions for both submit
 * (`SiloVaultActionsLib.submitMarketRemoval`) and finalize
 * (`SiloVaultActionsLib.updateWithdrawQueue`) paths. The per-market branch lives entirely
 * in this helper so the UI, batch builder, and button copy stay in lockstep.
 */
export function classifyMarketRemoval(
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null
): MarketRemovalMode {
  if (!state) return { kind: 'ineligible', reasons: [] }
  const reasons: SubmitMarketRemovalDisabledReason[] = []
  if (!state.enabled) reasons.push('not_enabled')
  if (state.pendingCapValidAt !== Z) reasons.push('pending_cap')
  if (state.removableAt !== Z && (chainNowSec == null || chainNowSec < state.removableAt)) {
    reasons.push('timelock_running')
  }
  if (reasons.length > 0) return { kind: 'ineligible', reasons }
  if (state.removableAt !== Z && chainNowSec != null && chainNowSec >= state.removableAt) {
    return { kind: 'finalize' }
  }
  return { kind: 'submit' }
}

/** One short sentence per blocker — safe to concatenate or use as a tooltip on its own. */
export function describeMarketRemovalDisabledReason(
  reason: SubmitMarketRemovalDisabledReason
): string {
  switch (reason) {
    case 'not_enabled':
      return 'Market is disabled in the vault.'
    case 'pending_cap':
      return 'A pending cap change blocks removal — revoke or accept it first.'
    case 'timelock_running':
      return 'Removal already pending.'
  }
}

/**
 * Human-readable blocker description — `null` when the market is eligible (either submit or
 * finalize path). The `timelock_running` case is replaced with `Removable in {d h m}` when
 * `chainNowSec` is known.
 */
export function describeMarketRemovalDisabledReasons(
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null = null
): string | null {
  const mode = classifyMarketRemoval(state, chainNowSec)
  if (mode.kind !== 'ineligible' || mode.reasons.length === 0) return null
  return mode.reasons
    .map((reason) => describeSingleReason(reason, state, chainNowSec))
    .join(' ')
}

function describeSingleReason(
  reason: SubmitMarketRemovalDisabledReason,
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null
): string {
  if (reason !== 'timelock_running' || state == null) {
    return describeMarketRemovalDisabledReason(reason)
  }
  if (chainNowSec == null) return 'Removal already pending.'
  const remaining = state.removableAt - chainNowSec
  if (remaining <= Z) return 'Removable now.'
  return `Removable in ${formatRemainingDuration(remaining)}.`
}

/** Compact duration for timelock countdowns — up to the two largest non-zero units. */
export function formatRemainingDuration(seconds: bigint): string {
  if (seconds <= Z) return '0m'
  const total = Number(seconds)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return '<1m'
}

export type UpdateWithdrawQueueRemovalBlocker =
  | 'no_pending_removal'
  | 'timelock_unknown'
  | 'timelock_running'
  | 'non_zero_cap'
  | 'pending_cap'

/**
 * Second step of forced removal. Ready only when `submitMarketRemoval` has set `removableAt`,
 * that timestamp has elapsed, the cap is already zero, and no cap change is pending.
 * Non-zero vault supply does not block this path — `updateWithdrawQueue` still removes the market.
 */
export type UpdateWithdrawQueueRemovalMode =
  | { kind: 'ready'; hasSupply: boolean }
  | { kind: 'blocked'; reasons: UpdateWithdrawQueueRemovalBlocker[] }

export function classifyUpdateWithdrawQueueRemoval(
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null
): UpdateWithdrawQueueRemovalMode {
  if (!state || state.removableAt === Z) {
    return { kind: 'blocked', reasons: ['no_pending_removal'] }
  }
  const reasons: UpdateWithdrawQueueRemovalBlocker[] = []
  if (chainNowSec == null) reasons.push('timelock_unknown')
  else if (chainNowSec < state.removableAt) reasons.push('timelock_running')
  if (state.cap !== Z) reasons.push('non_zero_cap')
  if (state.pendingCapValidAt !== Z) reasons.push('pending_cap')
  if (reasons.length > 0) return { kind: 'blocked', reasons }
  return { kind: 'ready', hasSupply: state.supplyShares !== Z }
}

export function describeUpdateWithdrawQueueRemovalBlocker(
  reason: UpdateWithdrawQueueRemovalBlocker,
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null
): string {
  switch (reason) {
    case 'no_pending_removal':
      return 'No pending market removal. Submit Market Removal first.'
    case 'timelock_unknown':
      return 'Checking the removal timelock…'
    case 'timelock_running':
      return describeSingleReason('timelock_running', state, chainNowSec)
    case 'non_zero_cap':
      return 'Supply cap is not zero, so updateWithdrawQueue cannot remove this market.'
    case 'pending_cap':
      return 'A pending cap change blocks removal. Revoke or accept it first.'
  }
}

/** Joined blocker copy for a market that cannot be dropped by `updateWithdrawQueue`. `null` when ready. */
export function describeUpdateWithdrawQueueRemoval(
  state: WithdrawMarketOnchainState | null | undefined,
  chainNowSec: bigint | null = null
): string | null {
  const mode = classifyUpdateWithdrawQueueRemoval(state, chainNowSec)
  if (mode.kind === 'ready') return null
  return mode.reasons
    .map((reason) => describeUpdateWithdrawQueueRemovalBlocker(reason, state, chainNowSec))
    .join(' ')
}

const UPDATE_WITHDRAW_QUEUE_REVERT_HINTS: { name: string; hint: string }[] = [
  {
    name: 'InvalidMarketRemovalNonZeroCap',
    hint: 'This market still has a non-zero supply cap, so updateWithdrawQueue cannot remove it.',
  },
  {
    name: 'PendingCap',
    hint: 'A pending cap change blocks updateWithdrawQueue. Revoke or accept it first.',
  },
  {
    name: 'InvalidMarketRemovalNonZeroSupply',
    hint: 'The vault still holds this market and no removal timelock has elapsed.',
  },
  {
    name: 'InvalidMarketRemovalTimelockNotElapsed',
    hint: 'The removal timelock has not elapsed yet.',
  },
  {
    name: 'NotAllocatorRole',
    hint: 'This wallet is not an owner, curator, or allocator of the vault.',
  },
]

/** Maps a decoded SiloVault revert to a short `updateWithdrawQueue` hint. */
export function hintForUpdateWithdrawQueueRevert(decoded: string): string | null {
  const trimmed = decoded.trim()
  for (const row of UPDATE_WITHDRAW_QUEUE_REVERT_HINTS) {
    if (trimmed === row.name || trimmed.startsWith(`${row.name}(`)) return row.hint
  }
  return null
}

/** User-facing message for a failed `updateWithdrawQueue` preflight or send. */
export function describeUpdateWithdrawQueueFailure(err: unknown): string {
  if (isUserRejectionError(err)) return 'Transaction rejected in wallet.'
  const decoded = describeVaultRevert(err)
  const raw = (decoded ?? (err instanceof Error ? err.message : '')).trim()
  const hint = hintForUpdateWithdrawQueueRevert(raw)
  if (hint) return hint
  return toUserErrorMessage(err)
}

export type SelectedMarketForRemoval = {
  address: string
  /** Current vault supply cap on this market, from the same read as the checkbox eligibility. */
  cap: bigint
  /** `submit` adds submitCap+submitMarketRemoval; `finalize` gets excluded from updateWithdrawQueue. */
  mode: 'submit' | 'finalize'
}

export type BuildSubmitMarketRemovalBatchParams = {
  /** Current withdraw queue in on-chain order — indexes we send to `updateWithdrawQueue` point into it. */
  withdrawQueue: string[]
  selected: SelectedMarketForRemoval[]
}

/**
 * One batch of vault calldata covering every selected market:
 *  - per `submit` market: `submitCap(market, 0)` when `cap > 0` (drops cap immediately —
 *    see `SiloVault._setCap`), then `submitMarketRemoval(market)`.
 *  - one trailing `updateWithdrawQueue(newIndexes)` when any `finalize` market is selected,
 *    where `newIndexes` lists the queue slots we keep. `updateWithdrawQueue` is the only
 *    on-chain finalization path once the forced-removal timelock has elapsed.
 */
export function buildSubmitMarketRemovalVaultCallDatas(
  params: BuildSubmitMarketRemovalBatchParams
): `0x${string}`[] {
  const out: `0x${string}`[] = []
  for (const m of params.selected) {
    if (m.mode !== 'submit') continue
    const market = getAddress(m.address)
    if (m.cap > Z) {
      out.push(vaultIface.encodeFunctionData('submitCap', [market, CAP_ARG_ZERO]) as `0x${string}`)
    }
    out.push(vaultIface.encodeFunctionData('submitMarketRemoval', [market]) as `0x${string}`)
  }
  const finalizeSet = buildFinalizeSet(params.selected)
  if (finalizeSet.size > 0) {
    const keepIndexes = computeKeepIndexes(params.withdrawQueue, finalizeSet)
    out.push(vaultIface.encodeFunctionData('updateWithdrawQueue', [keepIndexes]) as `0x${string}`)
  }
  return out
}

function buildFinalizeSet(selected: SelectedMarketForRemoval[]): Set<string> {
  const set = new Set<string>()
  for (const m of selected) {
    if (m.mode !== 'finalize') continue
    try {
      set.add(getAddress(m.address).toLowerCase())
    } catch {
      set.add(m.address.toLowerCase())
    }
  }
  return set
}

function computeKeepIndexes(withdrawQueue: string[], finalizeSet: Set<string>): number[] {
  const indexes: number[] = []
  for (let i = 0; i < withdrawQueue.length; i++) {
    const key = normalizeAddressLower(withdrawQueue[i] ?? '')
    if (finalizeSet.has(key)) continue
    indexes.push(i)
  }
  return indexes
}

function normalizeAddressLower(addr: string): string {
  try {
    return getAddress(addr).toLowerCase()
  } catch {
    return addr.toLowerCase()
  }
}

export type PlannedRemovalStep = {
  id: string
  market?: string
  method: 'submitCap' | 'submitMarketRemoval' | 'updateWithdrawQueue'
  argLabel: string
  copyValue: string
}

/** Mirrors `buildSubmitMarketRemovalVaultCallDatas` for the contract-style preview under the action. */
export function buildSubmitMarketRemovalPreview(
  params: BuildSubmitMarketRemovalBatchParams
): PlannedRemovalStep[] {
  const steps: PlannedRemovalStep[] = []
  const { withdrawQueue, selected } = params
  for (let i = 0; i < selected.length; i++) {
    const m = selected[i]!
    if (m.mode !== 'submit') continue
    const market = getAddress(m.address)
    if (m.cap > Z) {
      steps.push({
        id: `submitCap-${market}-${i}`,
        market,
        method: 'submitCap',
        argLabel: '_market (address), _newSupplyCap (uint256)',
        copyValue: `${market}, 0`,
      })
    }
    steps.push({
      id: `submitMarketRemoval-${market}-${i}`,
      market,
      method: 'submitMarketRemoval',
      argLabel: '_market (address)',
      copyValue: market,
    })
  }
  const finalizeSet = buildFinalizeSet(selected)
  if (finalizeSet.size > 0) {
    const keepIndexes = computeKeepIndexes(withdrawQueue, finalizeSet)
    steps.push({
      id: 'updateWithdrawQueue',
      method: 'updateWithdrawQueue',
      argLabel: '_indexes (uint256[])',
      copyValue: `[${keepIndexes.join(', ')}]`,
    })
  }
  return steps
}

export type ExecuteSubmitMarketRemovalParams = {
  ethereum: Eip1193Provider
  provider: Provider
  signer: Signer
  chainId: number
  vaultAddress: string
  ownerAddress: string
  curatorAddress: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
  connectedAccount: string
  withdrawQueue: string[]
  markets: SelectedMarketForRemoval[]
}

export type SubmitMarketRemovalSuccess = {
  transactionUrl: string
  successLinkLabel: string
  outcome: TxSubmitOutcome
}

export const SUBMIT_MARKET_REMOVAL_DENIED_MESSAGE =
  'You cannot submit market removals with this wallet. Connect as vault owner or curator (directly or as a Safe signer).'

export const UPDATE_WITHDRAW_QUEUE_DENIED_MESSAGE =
  'You cannot update the withdraw queue with this wallet. Connect as vault owner, curator, or allocator (directly or as a Safe signer).'

type SendAuthorizedVaultBatchParams = {
  auth: VaultActionAuthority
  deniedMessage: string
  ethereum: Eip1193Provider
  signer: Signer
  chainId: number
  vaultAddress: string
  connectedAccount: string
  callDatas: `0x${string}`[]
  safeOrigin: string
}

/**
 * Direct sends simulate with `estimateGas` (`assertVaultCallSucceeds`) before the wallet prompt.
 * Safe paths skip that simulation because `msg.sender` would be the EOA, not the Safe.
 */
async function sendAuthorizedVaultBatch(
  params: SendAuthorizedVaultBatchParams
): Promise<SubmitMarketRemovalSuccess> {
  const {
    auth,
    deniedMessage,
    ethereum,
    signer,
    chainId,
    vaultAddress,
    connectedAccount,
    callDatas,
    safeOrigin,
  } = params

  if (auth.mode === 'denied') {
    throw new Error(deniedMessage)
  }

  const batchCalls: TargetedCall[] = vaultCalldatasToTargetedCalls(vaultAddress, callDatas)

  if (auth.mode === 'direct') {
    await preflightDirectEstimateGas(signer, vaultAddress, callDatas)
    const txHash = await executeVaultCallsFromSigner(signer, vaultAddress, callDatas)
    const transactionUrl = getExplorerTxUrl(chainId, txHash)
    if (!transactionUrl) {
      throw new Error('Could not build a block explorer link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'View on explorer', outcome: 'explorer' }
  }

  if (auth.mode === 'safe_as_wallet' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await sendSafeWalletBatch({
      ethereum,
      chainId,
      from: safeAddress,
      calls: batchCalls,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_wallet_queue' }
  }

  if (auth.mode === 'safe_propose' && auth.executingSafeAddress != null) {
    const safeAddress = getAddress(auth.executingSafeAddress)
    await proposeReallocateRemoveWithdrawQueueViaSafe({
      ethereum,
      chainId,
      safeAddress,
      vaultAddress,
      proposerAccount: connectedAccount,
      batchCalls,
      origin: safeOrigin,
    })
    const transactionUrl = getSafeWalletQueueUrl(chainId, safeAddress)
    if (!transactionUrl) {
      throw new Error('Could not build a Safe{Wallet} link for this network.')
    }
    return { transactionUrl, successLinkLabel: 'Open queue', outcome: 'safe_queue' }
  }

  throw new Error(deniedMessage)
}

/**
 * Runs the submit-market-removal batch. `submitCap` + `submitMarketRemoval` are `onlyCuratorRole`,
 * so this path stays owner-or-curator. Dropping markets after the timelock is
 * {@link executeUpdateWithdrawQueueRemoval}.
 */
export async function executeSubmitMarketRemoval(
  params: ExecuteSubmitMarketRemovalParams
): Promise<SubmitMarketRemovalSuccess> {
  const {
    ethereum,
    provider,
    signer,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    curatorKind,
    connectedAccount,
    withdrawQueue,
    markets,
  } = params

  if (markets.length === 0) {
    throw new Error('Select at least one market to remove.')
  }

  const auth = await classifyOwnerOrCuratorVaultAction(
    provider,
    connectedAccount,
    { owner: ownerAddress, curator: curatorAddress },
    ownerKind,
    curatorKind
  )

  const callDatas = buildSubmitMarketRemovalVaultCallDatas({
    withdrawQueue,
    selected: markets,
  })

  return sendAuthorizedVaultBatch({
    auth,
    deniedMessage: SUBMIT_MARKET_REMOVAL_DENIED_MESSAGE,
    ethereum,
    signer,
    chainId,
    vaultAddress,
    connectedAccount,
    callDatas,
    safeOrigin: SAFE_TX_ORIGIN,
  })
}

/**
 * Drops markets whose forced-removal timelock has elapsed. `updateWithdrawQueue` is
 * `onlyAllocatorRole` (owner, curator, or allocator) and is a single call for every selected market.
 */
export async function executeUpdateWithdrawQueueRemoval(
  params: ExecuteSubmitMarketRemovalParams
): Promise<SubmitMarketRemovalSuccess> {
  const {
    ethereum,
    provider,
    signer,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    curatorKind,
    connectedAccount,
    withdrawQueue,
    markets,
  } = params

  if (markets.length === 0) {
    throw new Error('Select at least one market to remove.')
  }

  const auth = await classifyAllocatorVaultAction(
    provider,
    vaultAddress,
    connectedAccount,
    { owner: ownerAddress, curator: curatorAddress },
    ownerKind,
    curatorKind
  )

  const callDatas = buildSubmitMarketRemovalVaultCallDatas({
    withdrawQueue,
    selected: markets.map((market) => ({ ...market, mode: 'finalize' as const })),
  })

  return sendAuthorizedVaultBatch({
    auth,
    deniedMessage: UPDATE_WITHDRAW_QUEUE_DENIED_MESSAGE,
    ethereum,
    signer,
    chainId,
    vaultAddress,
    connectedAccount,
    callDatas,
    safeOrigin: UPDATE_WITHDRAW_QUEUE_SAFE_TX_ORIGIN,
  })
}

/**
 * EOA path only. Simulates the vault call and surfaces the decoded revert.
 * Wallet-as-Safe and Safe proposals skip this because `msg.sender` would be the EOA, not the Safe.
 */
async function preflightDirectEstimateGas(
  signer: Signer,
  vaultAddress: string,
  callDatas: `0x${string}`[]
): Promise<void> {
  const to = getAddress(vaultAddress)
  const data =
    callDatas.length === 1
      ? callDatas[0]
      : (vaultIface.encodeFunctionData('multicall', [callDatas]) as `0x${string}`)
  await assertVaultCallSucceeds(signer, to, data)
}
