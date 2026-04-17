'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Contract, formatUnits, getAddress } from 'ethers'
import erc20Artifact from '@/abis/ERC20.json'
import CopyButton from '@/components/CopyButton'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import { useVaultPermissions } from '@/contexts/VaultPermissionsContext'
import { useWeb3 } from '@/contexts/Web3Context'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import {
  buildReallocateAllocations,
  buildWithdrawQueueIndexesAfterRemoval,
  destinationsHaveEnoughHeadroom,
  buildWithdrawMarketRemovalVaultCallDatas,
  encodeUpdateWithdrawQueueOnly,
  executeReallocateRemoveWithdrawQueue,
  newSupplyQueueHasPositiveCaps,
  supplyQueueAfterRemovingMarket,
  vaultCalldatasToTargetedCalls,
  vaultMarketSupplyHeadroom,
  type MarketAllocationTuple,
} from '@/utils/reallocateRemoveWithdrawMarket'
import {
  classifyAllocatorVaultAction,
  classifyOwnerOrCuratorVaultAction,
  type VaultActionAuthority,
} from '@/utils/vaultActionAuthority'
import { formatWalletRpcFailureMessage } from '@/utils/rpcErrors'
import { getExplorerAddressUrl } from '@/utils/networks'
import { loadAbi } from '@/utils/loadAbi'
import {
  buildDustMitigationBatch,
  DUST_TOP_UP_WEI,
  DUST_HELP_TOOLTIP,
  isWithdrawMarketDustPosition,
} from '@/utils/withdrawMarketDust'
import { ONLY_FOR_OWNER_OR_CURATOR, ONLY_FOR_WITHDRAW_REMOVAL } from '@/utils/vaultActionRoleCopy'
import { formatSetSupplyQueueArgsCopy } from '@/utils/formatVaultActionCopyArgs'
import { formatVaultAmountWholeTokens, type VaultUnderlyingMeta } from '@/utils/vaultReader'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'
import type { TargetedCall } from '@/utils/vaultMulticall'

type Props = {
  chainId: number
  vaultAddress: string
  ownerAddress: string
  curatorAddress: string
  ownerKind: OwnerKind
  curatorKind: OwnerKind
  /** Current supply queue (same snapshot as the main vault UI). */
  supplyQueueMarkets: ResolvedMarket[]
  withdrawMarkets: ResolvedMarket[]
  /** Fetched with the vault Check — same order/length as `withdrawMarkets`. */
  withdrawMarketStates: WithdrawMarketOnchainState[]
  underlyingMeta: VaultUnderlyingMeta | null
  onCancel: () => void
}

const Z = BigInt(0)
const erc20Abi = loadAbi(erc20Artifact)

function addrKey(a: string): string {
  try {
    return getAddress(a)
  } catch {
    return a.toLowerCase()
  }
}

function shortAddr(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

/** EOA or Safe that will `approve` / pay `deposit` for dust mitigation (same as allowance owner). */
function dustUnderlyingExecutorAddress(params: {
  removeIndex: number | null
  withdrawMarketStates: WithdrawMarketOnchainState[]
  permLoading: boolean
  allocatorAuth: VaultActionAuthority | null
  ownerCuratorAuth: VaultActionAuthority | null
  account: string | null
}): string | null {
  const { removeIndex, withdrawMarketStates, permLoading, allocatorAuth, ownerCuratorAuth, account } = params
  if (removeIndex == null || !account) return null
  const st = withdrawMarketStates[removeIndex]
  if (!st || !isWithdrawMarketDustPosition(st)) return null
  const capAuth = st.cap > Z ? ownerCuratorAuth : allocatorAuth
  if (permLoading || !capAuth || capAuth.mode === 'denied') return null
  if (capAuth.mode === 'safe_propose' && capAuth.executingSafeAddress != null) {
    return getAddress(capAuth.executingSafeAddress)
  }
  return getAddress(account)
}

/**
 * Valid JSON: each tuple is `["0x…","uint256"]` (both quoted). Many contract UIs parse the argument as JSON.
 */
function formatReallocateArgsCopy(allocations: MarketAllocationTuple[]): string {
  const rows: [string, string][] = allocations.map((a) => {
    let m: string
    try {
      m = getAddress(a.market)
    } catch {
      m = a.market
    }
    return [m, a.assets.toString()]
  })
  return JSON.stringify(rows)
}

function formatSubmitCapArgsCopy(market: string): string {
  return `${getAddress(market)}, 0`
}

function formatUpdateWithdrawQueueArgsCopy(indexes: bigint[]): string {
  return `[${indexes.map((i) => i.toString()).join(', ')}]`
}

function DustPositionBadge() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-[var(--silo-danger)]">
      <span className="font-mono uppercase tracking-wide">DUST</span>
      <span className="group relative inline-flex items-center">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--silo-danger)_45%,var(--silo-border))] bg-[color-mix(in_srgb,var(--silo-danger)_10%,transparent)] text-[10px] font-bold leading-none text-[var(--silo-danger)] cursor-pointer"
          aria-label="Dust details"
          tabIndex={0}
        >
          i
        </span>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-64 max-w-[80vw] -translate-x-1/2 rounded-md border border-[var(--silo-border)] bg-[var(--silo-surface)] px-2 py-1 text-xs font-medium leading-snug text-[var(--silo-text)] shadow-sm opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {DUST_HELP_TOOLTIP}
        </span>
      </span>
    </span>
  )
}

export default function WithdrawQueueRemoveWizard({
  chainId,
  vaultAddress,
  ownerAddress,
  curatorAddress,
  ownerKind,
  curatorKind,
  supplyQueueMarkets,
  withdrawMarkets,
  withdrawMarketStates,
  underlyingMeta,
  onCancel,
}: Props) {
  const { provider, eip1193Provider, account, isConnected } = useWeb3()
  const perm = useVaultPermissions()
  const [busy, setBusy] = useState(false)
  const [execErr, setExecErr] = useState('')
  const [txSuccess, setTxSuccess] = useState<{
    url: string
    linkLabel: string
    outcome: TxSubmitOutcome
  } | null>(null)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  /** Destination markets in the order funds are routed (reallocate supply order). */
  const [destinations, setDestinations] = useState<string[]>([])
  /** When an Idle Vault exists in the withdraw queue (other than the removed row), route the full move there. */
  const [useIdleVaultForReallocate, setUseIdleVaultForReallocate] = useState(true)
  const [alsoRemoveFromSupplyQueue, setAlsoRemoveFromSupplyQueue] = useState(true)
  /** `underlying.allowance(executor, market)` for dust preview; null when not dust or loading. */
  const [dustPreviewAllowance, setDustPreviewAllowance] = useState<bigint | null>(null)
  /** `underlying.balanceOf(executor)` for dust deposit funding check. */
  const [dustExecutorBalance, setDustExecutorBalance] = useState<bigint | null>(null)

  const supplyQueueAddresses = useMemo(
    () =>
      supplyQueueMarkets.map((m) => {
        try {
          return getAddress(m.address)
        } catch {
          return m.address
        }
      }),
    [supplyQueueMarkets]
  )

  const statesAligned =
    withdrawMarkets.length === 0 || withdrawMarketStates.length === withdrawMarkets.length

  const stateByAddress = useMemo(() => {
    const m = new Map<string, WithdrawMarketOnchainState>()
    for (const s of withdrawMarketStates) {
      m.set(addrKey(s.address), s)
    }
    return m
  }, [withdrawMarketStates])

  const removedState = removeIndex != null ? withdrawMarketStates[removeIndex] : null
  const removedVaultAssets = removedState?.supplyAssets ?? Z
  const removedHasDustOnly =
    removedState != null && removedState.supplyShares > Z && removedVaultAssets === Z
  const routingAmount =
    removedState == null
      ? Z
      : removedState.supplyShares > Z && removedVaultAssets === Z
        ? DUST_TOP_UP_WEI
        : removedVaultAssets

  /** Another row in the withdraw queue that is our Idle Vault (local resolution from Check). */
  const idleDestinationInfo = useMemo(() => {
    if (removeIndex == null) return null
    for (let i = 0; i < withdrawMarkets.length; i++) {
      if (i === removeIndex) continue
      const m = withdrawMarkets[i]!
      if (m.kind === 'IdleVault') {
        return { index: i, address: m.address, label: m.label }
      }
    }
    return null
  }, [withdrawMarkets, removeIndex])

  const idleDestinationAddressNorm = useMemo(() => {
    if (!idleDestinationInfo) return null
    try {
      return getAddress(idleDestinationInfo.address)
    } catch {
      return null
    }
  }, [idleDestinationInfo])

  const removingIdleVault =
    removeIndex != null && withdrawMarkets[removeIndex]?.kind === 'IdleVault'

  const applyRemoveIndex = useCallback(
    (i: number) => {
      setRemoveIndex(i)
      if (withdrawMarkets[i]!.kind === 'IdleVault') {
        setUseIdleVaultForReallocate(false)
        setDestinations([])
        return
      }
      let hasOtherIdle = false
      for (let j = 0; j < withdrawMarkets.length; j++) {
        if (j === i) continue
        if (withdrawMarkets[j]!.kind === 'IdleVault') {
          hasOtherIdle = true
          break
        }
      }
      if (hasOtherIdle) {
        setUseIdleVaultForReallocate(true)
        setDestinations([])
      } else {
        setUseIdleVaultForReallocate(false)
      }
    },
    [withdrawMarkets]
  )

  const effectiveDestinationMarkets = useMemo(() => {
    if (routingAmount <= Z) return [] as string[]
    if (
      !removingIdleVault &&
      idleDestinationAddressNorm != null &&
      useIdleVaultForReallocate
    ) {
      return [idleDestinationAddressNorm]
    }
    return destinations
  }, [
    routingAmount,
    removingIdleVault,
    idleDestinationAddressNorm,
    useIdleVaultForReallocate,
    destinations,
  ])

  const supplyMap = useMemo(() => {
    const m = new Map<string, bigint>()
    for (const s of withdrawMarketStates) {
      m.set(addrKey(s.address), s.supplyAssets)
    }
    return m
  }, [withdrawMarketStates])

  /** Synthetic source assets for dust so off-chain `reallocate` packing matches on-chain post top-up. */
  const supplyMapForAllocations = useMemo(() => {
    const m = new Map(supplyMap)
    if (removeIndex != null && removedHasDustOnly && removedState) {
      m.set(addrKey(removedState.address), DUST_TOP_UP_WEI)
    }
    return m
  }, [supplyMap, removeIndex, removedHasDustOnly, removedState])

  const capMap = useMemo(() => {
    const m = new Map<string, bigint>()
    for (const s of withdrawMarketStates) {
      m.set(addrKey(s.address), s.cap)
    }
    return m
  }, [withdrawMarketStates])

  const removedMarketInSupplyQueue =
    removeIndex != null &&
    supplyQueueAddresses.some((a) => addrKey(a) === addrKey(withdrawMarkets[removeIndex]!.address))

  const projectedSupplyQueueAfterRemoval =
    removeIndex != null
      ? supplyQueueAfterRemovingMarket(supplyQueueAddresses, withdrawMarkets[removeIndex]!.address)
      : []

  const supplyQueueRemovalCapsOk =
    !alsoRemoveFromSupplyQueue ||
    !removedMarketInSupplyQueue ||
    newSupplyQueueHasPositiveCaps(projectedSupplyQueueAfterRemoval, capMap)

  const headroomOk =
    routingAmount === Z ||
    (effectiveDestinationMarkets.length > 0 &&
      destinationsHaveEnoughHeadroom({
        amountToMove: routingAmount,
        destinationMarkets: effectiveDestinationMarkets,
        supplyAssetsByMarket: supplyMapForAllocations,
        capByMarket: capMap,
      }))

  const removalPreconditionsOk =
    removedState != null &&
    removedState.pendingCapValidAt === Z &&
    removedState.removableAt === Z &&
    (removedVaultAssets === Z || removedState.enabled)

  const destinationsValid =
    routingAmount === Z ||
    (effectiveDestinationMarkets.length > 0 &&
      effectiveDestinationMarkets.every((d) => {
        const st = stateByAddress.get(addrKey(d))
        if (st == null || !st.enabled || st.cap <= Z) return false
        return vaultMarketSupplyHeadroom(st.supplyAssets, st.cap) > Z
      }))

  const removedForAuth = removeIndex != null && statesAligned ? withdrawMarketStates[removeIndex] : null
  const needsOwnerOrCuratorForCap = removedForAuth != null && removedForAuth.cap > Z
  const execAuthorityLoading = perm.active && perm.loading
  const effectiveAuth = needsOwnerOrCuratorForCap ? perm.ownerCuratorAuth : perm.allocatorAuth
  const deniedByRoleForCurrentStep =
    perm.active &&
    !perm.loading &&
    effectiveAuth != null &&
    effectiveAuth.mode === 'denied'

  const canExecute =
    isConnected &&
    provider != null &&
    eip1193Provider != null &&
    account != null &&
    removeIndex != null &&
    removalPreconditionsOk &&
    headroomOk &&
    destinationsValid &&
    !busy &&
    statesAligned &&
    supplyQueueRemovalCapsOk &&
    !execAuthorityLoading &&
    effectiveAuth != null &&
    effectiveAuth.mode !== 'denied' &&
    (!removedHasDustOnly || underlyingMeta != null)

  const dustExecutorAddress = useMemo(
    () =>
      dustUnderlyingExecutorAddress({
        removeIndex,
        withdrawMarketStates,
        permLoading: perm.loading,
        allocatorAuth: perm.allocatorAuth,
        ownerCuratorAuth: perm.ownerCuratorAuth,
        account,
      }),
    [
      removeIndex,
      withdrawMarketStates,
      perm.loading,
      perm.allocatorAuth,
      perm.ownerCuratorAuth,
      account,
    ]
  )

  const dustFundingWarning =
    removedHasDustOnly &&
    underlyingMeta != null &&
    dustExecutorAddress != null &&
    dustExecutorBalance != null &&
    dustExecutorBalance < DUST_TOP_UP_WEI

  useEffect(() => {
    if (!provider || !underlyingMeta || removeIndex == null || !statesAligned || dustExecutorAddress == null) {
      setDustPreviewAllowance(null)
      setDustExecutorBalance(null)
      return
    }
    const st = withdrawMarketStates[removeIndex]
    if (!st || !isWithdrawMarketDustPosition(st)) {
      setDustPreviewAllowance(null)
      setDustExecutorBalance(null)
      return
    }
    let cancelled = false
    const token = new Contract(underlyingMeta.address, erc20Abi, provider)
    void Promise.all([token.allowance(dustExecutorAddress, st.address), token.balanceOf(dustExecutorAddress)])
      .then(([allow, bal]: [unknown, unknown]) => {
        if (!cancelled) {
          setDustPreviewAllowance(BigInt(String(allow)))
          setDustExecutorBalance(BigInt(String(bal)))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDustPreviewAllowance(null)
          setDustExecutorBalance(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    provider,
    underlyingMeta,
    removeIndex,
    statesAligned,
    withdrawMarketStates,
    dustExecutorAddress,
  ])

  const formatBal = useCallback(
    (assets: bigint): string => {
      if (!underlyingMeta) return assets.toString()
      try {
        return `${formatUnits(assets, underlyingMeta.decimals)} ${underlyingMeta.symbol}`
      } catch {
        return assets.toString()
      }
    },
    [underlyingMeta]
  )

  const formatCapWhole = useCallback(
    (cap: bigint) => formatVaultAmountWholeTokens(cap, underlyingMeta),
    [underlyingMeta]
  )

  const toggleDestination = useCallback(
    (marketAddress: string) => {
      const k = addrKey(marketAddress)
      setDestinations((prev) => {
        const idx = prev.findIndex((a) => addrKey(a) === k)
        if (idx >= 0) {
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
        }
        return [...prev, getAddress(marketAddress)]
      })
    },
    []
  )

  const handleExecute = useCallback(async () => {
    setExecErr('')
    setTxSuccess(null)
    if (!provider || !account || !eip1193Provider || removeIndex == null || !statesAligned) {
      setExecErr('Wallet or data not ready.')
      return
    }
    const indexes = buildWithdrawQueueIndexesAfterRemoval(removeIndex, withdrawMarkets.length)
    const removed = withdrawMarketStates[removeIndex]
    const needSubmitCap = removed.cap > Z
    const dust = isWithdrawMarketDustPosition(removed)
    const routeAmt =
      removed.supplyShares > Z && removed.supplyAssets === Z ? DUST_TOP_UP_WEI : removed.supplyAssets
    const inSupply = supplyQueueAddresses.some((a) => addrKey(a) === addrKey(removed.address))
    const newSupplyQueue =
      alsoRemoveFromSupplyQueue && inSupply
        ? supplyQueueAfterRemovingMarket(supplyQueueAddresses, removed.address)
        : undefined
    const fullyEmpty = removed.supplyShares === Z && removed.supplyAssets === Z

    let vaultCallDatas: `0x${string}`[]
    try {
      if (fullyEmpty && !needSubmitCap && newSupplyQueue === undefined) {
        vaultCallDatas = [encodeUpdateWithdrawQueueOnly(indexes)]
      } else {
        const allocations =
          routeAmt > Z
            ? buildReallocateAllocations({
                sourceMarket: removed.address,
                destinationMarkets: effectiveDestinationMarkets,
                supplyAssetsByMarket: supplyMapForAllocations,
                capByMarket: capMap,
              })
            : null
        vaultCallDatas = buildWithdrawMarketRemovalVaultCallDatas({
          allocations,
          removedMarket: removed.address,
          newQueueIndexes: indexes,
          includeSubmitCapZero: needSubmitCap,
          newSupplyQueue,
        })
      }
    } catch (e) {
      setExecErr(e instanceof Error ? e.message : String(e))
      return
    }

    let dustPrefix: TargetedCall[] = []
    if (dust) {
      if (!underlyingMeta) {
        setExecErr('Vault underlying asset is unknown; run Check again before dust mitigation.')
        return
      }
      const overview = { owner: ownerAddress, curator: curatorAddress }
      let auth: VaultActionAuthority
      try {
        auth = needSubmitCap
          ? await classifyOwnerOrCuratorVaultAction(provider, account, overview, ownerKind, curatorKind)
          : await classifyAllocatorVaultAction(
              provider,
              vaultAddress,
              account,
              overview,
              ownerKind,
              curatorKind
            )
      } catch (e) {
        setExecErr(formatWalletRpcFailureMessage(e))
        return
      }
      if (auth.mode === 'denied') {
        setExecErr('Wallet cannot execute dust top-up for this batch.')
        return
      }
      const approver =
        auth.mode === 'safe_propose' && auth.executingSafeAddress != null
          ? getAddress(auth.executingSafeAddress)
          : getAddress(account)
      const token = new Contract(underlyingMeta.address, erc20Abi, provider)
      const cur = BigInt(String(await token.allowance(approver, removed.address)))
      dustPrefix = buildDustMitigationBatch({
        underlying: underlyingMeta.address,
        market: removed.address,
        vault: vaultAddress,
        topUpAmount: DUST_TOP_UP_WEI,
        currentAllowance: cur,
      }).calls
    }

    const batchCalls = [...dustPrefix, ...vaultCalldatasToTargetedCalls(vaultAddress, vaultCallDatas)]

    setBusy(true)
    try {
      const signer = await provider.getSigner()
      const { transactionUrl, successLinkLabel, outcome } = await executeReallocateRemoveWithdrawQueue({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        vaultAddress,
        ownerAddress,
        curatorAddress,
        ownerKind,
        curatorKind,
        connectedAccount: account,
        requiresOwnerOrCuratorCapabilities: needSubmitCap,
        batchCalls,
      })
      setTxSuccess({ url: transactionUrl, linkLabel: successLinkLabel, outcome })
    } catch (e) {
      setExecErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [
    provider,
    eip1193Provider,
    account,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    curatorKind,
    removeIndex,
    withdrawMarketStates,
    statesAligned,
    withdrawMarkets.length,
    effectiveDestinationMarkets,
    supplyMapForAllocations,
    capMap,
    alsoRemoveFromSupplyQueue,
    supplyQueueAddresses,
    underlyingMeta,
  ])

  const readyToRoute = removeIndex != null && headroomOk && removalPreconditionsOk && destinationsValid
  const showManualDestinationPicker =
    routingAmount > Z &&
    (removingIdleVault ||
      idleDestinationInfo == null ||
      idleDestinationAddressNorm == null ||
      !useIdleVaultForReallocate)
  const hideUnselectedMoveButtons = readyToRoute && routingAmount > Z && showManualDestinationPicker

  const vaultActionPreview = useMemo(() => {
    if (removeIndex == null || !statesAligned) return null
    const removed = withdrawMarketStates[removeIndex]
    if (removed == null) return null
    const needSubmitCap = removed.cap > Z
    const inSupply = supplyQueueAddresses.some((a) => addrKey(a) === addrKey(removed.address))
    const newSupplyQueue =
      alsoRemoveFromSupplyQueue && inSupply
        ? supplyQueueAfterRemovingMarket(supplyQueueAddresses, removed.address)
        : undefined

    const withdrawIndexes = buildWithdrawQueueIndexesAfterRemoval(removeIndex, withdrawMarkets.length)

    type Step = { id: string; method: string; argLabel: string; copyValue: string }
    const steps: Step[] = []
    if (
      underlyingMeta != null &&
      isWithdrawMarketDustPosition(removed) &&
      dustPreviewAllowance != null
    ) {
      const { copySteps } = buildDustMitigationBatch({
        underlying: underlyingMeta.address,
        market: removed.address,
        vault: vaultAddress,
        topUpAmount: DUST_TOP_UP_WEI,
        currentAllowance: dustPreviewAllowance,
      })
      for (const s of copySteps) {
        steps.push({ id: s.id, method: s.method, argLabel: s.argLabel, copyValue: s.copyValue })
      }
    }
    if (routingAmount > Z) {
      let allocs: MarketAllocationTuple[]
      if (effectiveDestinationMarkets.length > 0) {
        try {
          allocs = buildReallocateAllocations({
            sourceMarket: removed.address,
            destinationMarkets: effectiveDestinationMarkets,
            supplyAssetsByMarket: supplyMapForAllocations,
            capByMarket: capMap,
          })
        } catch {
          allocs = [{ market: getAddress(removed.address), assets: Z }]
        }
      } else {
        allocs = [{ market: getAddress(removed.address), assets: Z }]
      }
      steps.push({
        id: 'reallocate',
        method: 'reallocate',
        argLabel: '_allocations (tuple[])',
        copyValue: formatReallocateArgsCopy(allocs),
      })
    }
    if (needSubmitCap) {
      steps.push({
        id: 'submitCap',
        method: 'submitCap',
        argLabel: '_market (address), _newSupplyCap (uint256)',
        copyValue: formatSubmitCapArgsCopy(removed.address),
      })
    }
    steps.push({
      id: 'updateWithdrawQueue',
      method: 'updateWithdrawQueue',
      argLabel: '_indexes (uint256[])',
      copyValue: formatUpdateWithdrawQueueArgsCopy(withdrawIndexes),
    })
    if (newSupplyQueue !== undefined) {
      steps.push({
        id: 'setSupplyQueue',
        method: 'setSupplyQueue',
        argLabel: '_newSupplyQueue (address[])',
        copyValue: formatSetSupplyQueueArgsCopy(newSupplyQueue),
      })
    }
    return steps
  }, [
    removeIndex,
    statesAligned,
    withdrawMarketStates,
    supplyQueueAddresses,
    alsoRemoveFromSupplyQueue,
    routingAmount,
    effectiveDestinationMarkets,
    supplyMapForAllocations,
    capMap,
    withdrawMarkets.length,
    underlyingMeta,
    vaultAddress,
    dustPreviewAllowance,
  ])

  if (withdrawMarkets.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm silo-text-soft">The withdraw queue is empty.</p>
        <button type="button" onClick={onCancel} className="silo-btn-primary">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-sm font-medium silo-text-soft hover:silo-text-main">
          {txSuccess ? 'Close' : 'Cancel'}
        </button>
      </div>

      {!statesAligned && withdrawMarkets.length > 0 ? (
        <p className="text-sm silo-alert silo-alert-error">
          Withdraw queue data does not match the loaded vault. Press <strong>Check</strong> again.
        </p>
      ) : null}

      {statesAligned ? (
        <>
          {removeIndex == null ? (
            <fieldset className="space-y-2 min-w-0 border-0 p-0 m-0">
              <legend className="text-sm font-medium silo-text-main mb-2 px-0">Choose a market to remove</legend>
              <div className="space-y-2" role="radiogroup" aria-label="Withdraw queue market to remove">
                {withdrawMarkets.map((m, i) => {
                  const st = withdrawMarketStates[i]
                  return (
                    <label
                      key={`${m.address}-${i}`}
                      className="silo-choice-option cursor-pointer"
                      data-selected={removeIndex === i ? 'true' : 'false'}
                    >
                      <span
                        className="w-6 shrink-0 text-right text-xs font-mono tabular-nums silo-text-soft pt-1 select-none"
                        aria-hidden
                      >
                        {i}
                      </span>
                      <input
                        type="radio"
                        name="withdraw-remove-market"
                        checked={removeIndex === i}
                        onChange={() => applyRemoveIndex(i)}
                        className="sr-only"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold silo-text-main">{m.label}</span>
                          {m.siloConfigId !== undefined ? (
                            <span className="text-sm font-mono tabular-nums silo-text-soft">
                              #{m.siloConfigId.toString()}
                            </span>
                          ) : null}
                          <span className="text-xs shrink-0 inline-flex items-center gap-1">
                            <span className="silo-text-soft">assets </span>
                            {isWithdrawMarketDustPosition(st) ? (
                              <DustPositionBadge />
                            ) : (
                              <span className="font-mono tabular-nums silo-text-main">{formatBal(st.supplyAssets)}</span>
                            )}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 min-w-0">
                          <span className="text-xs font-mono silo-text-soft break-all min-w-0" title={m.address}>
                            {m.address}
                          </span>
                          <CopyButton value={m.address} />
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : (
            <div className="space-y-4">
              <div className="silo-choice-option" data-selected="true">
                <div className="w-full space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide silo-text-danger-muted">Removing</p>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold silo-text-main">
                      {withdrawMarkets[removeIndex]?.label}
                    </span>
                    {withdrawMarkets[removeIndex]?.siloConfigId !== undefined ? (
                      <span className="text-sm font-mono tabular-nums silo-text-soft">
                        #{withdrawMarkets[removeIndex]!.siloConfigId!.toString()}
                      </span>
                    ) : null}
                    {removedState ? (
                      <span className="text-xs shrink-0 inline-flex items-center gap-1">
                        <span className="silo-text-soft">assets </span>
                        {isWithdrawMarketDustPosition(removedState) ? (
                          <DustPositionBadge />
                        ) : (
                          <span className="font-mono tabular-nums silo-text-main">
                            {formatBal(removedState.supplyAssets)}
                          </span>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span
                      className="text-xs font-mono silo-text-soft break-all min-w-0"
                      title={withdrawMarkets[removeIndex]?.address}
                    >
                      {withdrawMarkets[removeIndex]?.address}
                    </span>
                    {withdrawMarkets[removeIndex]?.address ? (
                      <CopyButton value={withdrawMarkets[removeIndex].address} />
                    ) : null}
                  </div>
                  {removedState &&
                  (removedState.pendingCapValidAt !== Z || removedState.removableAt !== Z) ? (
                    <div className="text-sm silo-text-main pt-1 space-y-0.5">
                      {removedState.pendingCapValidAt !== Z ? (
                        <p className="text-sm silo-alert silo-alert-error">Resolve or wait out the pending cap change first.</p>
                      ) : null}
                      {removedState.removableAt !== Z ? (
                        <p className="text-sm silo-alert silo-alert-error">
                          A forced removal is pending on this market (<code className="font-mono text-xs">submitMarketRemoval</code>
                          ). Finish or revoke it before changing the cap.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                className="text-xs font-medium silo-text-soft hover:silo-text-main underline"
                onClick={() => {
                  setRemoveIndex(null)
                  setDestinations([])
                  setUseIdleVaultForReallocate(true)
                  setAlsoRemoveFromSupplyQueue(true)
                }}
              >
                Choose another market
              </button>

              {removeIndex != null &&
              statesAligned &&
              removedState &&
              removedState.supplyShares === Z &&
              removedState.supplyAssets === Z ? (
                <p className="text-sm silo-text-soft max-w-prose">
                  There are no vault funds on this market to move, so reallocation is not needed. You can still remove it
                  from the withdraw queue (and zero the cap if applicable) with <strong>Execute</strong> below.
                </p>
              ) : null}

              {removedHasDustOnly && effectiveAuth?.mode === 'direct' ? (
                <p className="text-xs silo-text-soft max-w-prose">
                  Dust mitigation sends ERC-20 / ERC-4626 transactions from your wallet first; you may need several
                  confirmations, then the vault transaction(s).
                </p>
              ) : null}

              {routingAmount > Z && idleDestinationInfo != null && idleDestinationAddressNorm != null ? (
                <label
                  className={`flex items-start gap-3 select-none max-w-prose ${
                    removingIdleVault ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={removingIdleVault}
                    checked={removingIdleVault ? false : useIdleVaultForReallocate}
                    onChange={(e) => {
                      if (removingIdleVault) return
                      const on = e.target.checked
                      setUseIdleVaultForReallocate(on)
                      if (on) setDestinations([])
                    }}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--silo-border)] silo-text-main disabled:cursor-not-allowed"
                  />
                  <span className="text-sm silo-text-main">Move all funds to Idle Vault.</span>
                </label>
              ) : null}

              {showManualDestinationPicker ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium silo-text-main">Choose a market to move funds to</p>
                  <ul className="space-y-2">
                    {withdrawMarkets.map((m, i) => {
                      if (i === removeIndex) return null
                      const st = withdrawMarketStates[i]
                      const selected = destinations.some((d) => addrKey(d) === addrKey(m.address))
                      if (hideUnselectedMoveButtons && !selected) return null
                      const canPick =
                        st.enabled && st.cap > Z && vaultMarketSupplyHeadroom(st.supplyAssets, st.cap) > Z
                      return (
                        <li
                          key={`dest-${m.address}-${i}`}
                          className={`silo-choice-option ${canPick ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                          data-no-interaction={canPick ? undefined : 'true'}
                          data-selected={selected ? 'true' : 'false'}
                          role={canPick ? 'button' : undefined}
                          tabIndex={canPick ? 0 : undefined}
                          aria-pressed={canPick ? selected : undefined}
                          onClick={
                            canPick
                              ? () => {
                                  toggleDestination(m.address)
                                }
                              : undefined
                          }
                          onKeyDown={
                            canPick
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    toggleDestination(m.address)
                                  }
                                }
                              : undefined
                          }
                        >
                          <span className="text-xs font-mono silo-text-soft w-6 shrink-0">{i}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                              <span className="text-sm font-semibold silo-text-main">{m.label}</span>
                              {m.siloConfigId !== undefined ? (
                                <span className="text-sm font-mono tabular-nums silo-text-soft">
                                  #{m.siloConfigId.toString()}
                                </span>
                              ) : null}
                              <span className="text-xs shrink-0 inline-flex items-center gap-1">
                                <span className="silo-text-soft">assets </span>
                                {isWithdrawMarketDustPosition(st) ? (
                                  <DustPositionBadge />
                                ) : (
                                  <span className="font-mono tabular-nums silo-text-main">
                                    {formatBal(st.supplyAssets)}
                                  </span>
                                )}
                              </span>
                              <span className="text-xs shrink-0">
                                <span className="silo-text-soft">(cap </span>
                                <span className="font-mono tabular-nums silo-text-main">{formatCapWhole(st.cap)}</span>
                                <span className="silo-text-soft">)</span>
                              </span>
                            </div>
                          </div>
                          {!canPick ? (
                            <span className="text-xs silo-text-soft shrink-0 self-center">Not available</span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}

              {removedMarketInSupplyQueue ? (
                <label className="flex items-start gap-3 cursor-pointer select-none max-w-prose">
                  <input
                    type="checkbox"
                    checked={alsoRemoveFromSupplyQueue}
                    onChange={(e) => setAlsoRemoveFromSupplyQueue(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--silo-border)] silo-text-main"
                  />
                  <span className="text-sm silo-text-main">Also remove this market from the supply queue.</span>
                </label>
              ) : null}

              {alsoRemoveFromSupplyQueue && removedMarketInSupplyQueue && !supplyQueueRemovalCapsOk ? (
                <p className="text-sm silo-alert silo-alert-error">
                  Every market left in the supply queue must have a positive cap in vault config. Run <strong>Check</strong>{' '}
                  again or adjust caps so all remaining supply-queue markets are loaded with cap &gt; 0.
                </p>
              ) : null}

              {!headroomOk && routingAmount > Z && effectiveDestinationMarkets.length > 0 ? (
                <p className="text-sm silo-alert silo-alert-error">
                  No single selected market has enough cap headroom for the full amount. Include a market that can absorb it
                  all (or remove liquidity from the source first).
                </p>
              ) : null}

              {vaultActionPreview ? (
                <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
                  <p className="text-sm font-medium silo-text-main">Planned calls</p>
                  <ol className="list-decimal list-outside space-y-4 text-sm silo-text-main m-0 pl-5 sm:pl-6">
                    {vaultActionPreview.map((s) => (
                      <li key={s.id} className="min-w-0 pl-1 space-y-1.5">
                        <p className="text-sm silo-text-main m-0 leading-snug">
                          <code className="text-xs font-mono silo-text-main">{s.method}</code>
                          <span className="silo-text-soft"> · </span>
                          <span className="text-xs silo-text-soft">{s.argLabel}</span>
                        </p>
                        <div className="flex flex-wrap items-start gap-2 min-w-0">
                          <pre className="text-xs font-mono silo-text-main whitespace-pre-wrap break-all flex-1 min-w-0 m-0">
                            {s.copyValue}
                          </pre>
                          <CopyButton value={s.copyValue} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {dustFundingWarning && underlyingMeta && dustExecutorAddress ? (
                <div className="text-sm silo-alert silo-alert-warning">
                  <p className="m-0 font-semibold silo-text-main">Warning</p>
                  <p className="mt-2 mb-0 leading-relaxed silo-text-main">
                    You can still propose or send this batch, but the <strong>deposit</strong> step needs the executor to
                    hold at least <strong>{DUST_TOP_UP_WEI.toString()} wei</strong>{' '}
                    <a
                      href={getExplorerAddressUrl(chainId, getAddress(underlyingMeta.address))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline decoration-1 underline-offset-2 hover:opacity-90"
                    >
                      {underlyingMeta.symbol.trim() || 'underlying'}
                    </a>{' '}
                    on{' '}
                    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                      <a
                        href={getExplorerAddressUrl(chainId, dustExecutorAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs font-semibold underline decoration-1 underline-offset-2 hover:opacity-90 tabular-nums"
                      >
                        {shortAddr(dustExecutorAddress)}
                      </a>
                      <CopyButton value={dustExecutorAddress} />
                    </span>
                    . Send that <strong>{DUST_TOP_UP_WEI.toString()} wei</strong> of this token to this address before
                    executing so the dust top-up can succeed.
                  </p>
                </div>
              ) : null}

              <button
                type="button"
                disabled={!canExecute || !readyToRoute}
                onClick={() => void handleExecute()}
                className="silo-btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Signing proposal…' : 'Execute'}
              </button>
              {removeIndex != null ? (
                <ActionPermissionHint
                  allowed={!deniedByRoleForCurrentStep || execAuthorityLoading}
                  onlyForLabel={
                    needsOwnerOrCuratorForCap ? ONLY_FOR_OWNER_OR_CURATOR : ONLY_FOR_WITHDRAW_REMOVAL
                  }
                />
              ) : null}
              {execErr ? <p className="text-sm silo-alert silo-alert-error">{execErr}</p> : null}

              {txSuccess ? (
                <div className="pt-2 border-t border-[var(--silo-border)]">
                  <TransactionSuccessSummary
                    url={txSuccess.url}
                    linkLabel={txSuccess.linkLabel}
                    outcome={txSuccess.outcome}
                  />
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
