'use client'

import { useCallback, useMemo, useState } from 'react'
import { formatUnits, getAddress } from 'ethers'
import CopyButton from '@/components/CopyButton'
import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import { useWeb3 } from '@/contexts/Web3Context'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import type { OwnerKind } from '@/utils/ownerKind'
import type { ResolvedMarket } from '@/utils/resolveVaultMarket'
import {
  buildReallocateAllocations,
  buildWithdrawQueueIndexesAfterRemoval,
  destinationsHaveEnoughHeadroom,
  encodeUpdateWithdrawQueueOnly,
  encodeWithdrawMarketRemovalBundle,
  newSupplyQueueHasPositiveCaps,
  proposeReallocateRemoveWithdrawQueueMultisigOnly,
  supplyQueueAfterRemovingMarket,
  vaultMarketSupplyHeadroom,
  type MarketAllocationTuple,
} from '@/utils/reallocateRemoveWithdrawMarket'
import { formatVaultAmountWholeTokens, type VaultUnderlyingMeta } from '@/utils/vaultReader'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

type Props = {
  chainId: number
  vaultAddress: string
  ownerAddress: string
  ownerKind: OwnerKind
  /** Current supply queue (same snapshot as the main vault UI). */
  supplyQueueMarkets: ResolvedMarket[]
  withdrawMarkets: ResolvedMarket[]
  /** Fetched with the vault Check — same order/length as `withdrawMarkets`. */
  withdrawMarketStates: WithdrawMarketOnchainState[]
  underlyingMeta: VaultUnderlyingMeta | null
  onCancel: () => void
}

const Z = BigInt(0)

function addrKey(a: string): string {
  try {
    return getAddress(a)
  } catch {
    return a.toLowerCase()
  }
}

/**
 * Valid JSON: each tuple is `["0x…","uint256"]` (both quoted). Many multisig UIs parse the argument as JSON.
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

function formatSetSupplyQueueArgsCopy(addresses: string[]): string {
  const parts = addresses.map((raw) => {
    try {
      return getAddress(raw)
    } catch {
      return raw
    }
  })
  return `[${parts.join(', ')}]`
}

export default function WithdrawQueueRemoveWizard({
  chainId,
  vaultAddress,
  ownerAddress,
  ownerKind,
  supplyQueueMarkets,
  withdrawMarkets,
  withdrawMarketStates,
  underlyingMeta,
  onCancel,
}: Props) {
  const { provider, account, isConnected } = useWeb3()
  const [busy, setBusy] = useState(false)
  const [execErr, setExecErr] = useState('')
  const [successUrl, setSuccessUrl] = useState<string | null>(null)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  /** Destination markets in the order funds are routed (reallocate supply order). */
  const [destinations, setDestinations] = useState<string[]>([])
  const [alsoRemoveFromSupplyQueue, setAlsoRemoveFromSupplyQueue] = useState(false)

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
  const amountToMove = removedState?.supplyAssets ?? Z

  const supplyMap = useMemo(() => {
    const m = new Map<string, bigint>()
    for (const s of withdrawMarketStates) {
      m.set(addrKey(s.address), s.supplyAssets)
    }
    return m
  }, [withdrawMarketStates])

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
    amountToMove === Z ||
    (destinations.length > 0 &&
      destinationsHaveEnoughHeadroom({
        amountToMove,
        destinationMarkets: destinations,
        supplyAssetsByMarket: supplyMap,
        capByMarket: capMap,
      }))

  const removalPreconditionsOk =
    removedState != null &&
    removedState.pendingCapValidAt === Z &&
    removedState.removableAt === Z &&
    (amountToMove === Z || removedState.enabled)

  const destinationsValid =
    amountToMove === Z ||
    (destinations.length > 0 &&
      destinations.every((d) => {
        const st = stateByAddress.get(addrKey(d))
        if (st == null || !st.enabled || st.cap <= Z) return false
        return vaultMarketSupplyHeadroom(st.supplyAssets, st.cap) > Z
      }))

  const canExecute =
    ownerKind === 'safe' &&
    isConnected &&
    provider != null &&
    account != null &&
    typeof window !== 'undefined' &&
    window.ethereum != null &&
    removeIndex != null &&
    removalPreconditionsOk &&
    headroomOk &&
    destinationsValid &&
    !busy &&
    statesAligned &&
    supplyQueueRemovalCapsOk

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
    setSuccessUrl(null)
    if (!provider || !account || !window.ethereum || removeIndex == null || !statesAligned) {
      setExecErr('Wallet or data not ready.')
      return
    }
    const indexes = buildWithdrawQueueIndexesAfterRemoval(removeIndex, withdrawMarkets.length)
    const removed = withdrawMarketStates[removeIndex]
    const needSubmitCap = removed.cap > Z
    const inSupply = supplyQueueAddresses.some((a) => addrKey(a) === addrKey(removed.address))
    const newSupplyQueue =
      alsoRemoveFromSupplyQueue && inSupply
        ? supplyQueueAfterRemovingMarket(supplyQueueAddresses, removed.address)
        : undefined
    let vaultCalldata: `0x${string}`
    try {
      if (amountToMove === Z && !needSubmitCap && newSupplyQueue === undefined) {
        vaultCalldata = encodeUpdateWithdrawQueueOnly(indexes)
      } else {
        const allocations =
          amountToMove > Z
            ? buildReallocateAllocations({
                sourceMarket: removed.address,
                destinationMarkets: destinations,
                supplyAssetsByMarket: supplyMap,
                capByMarket: capMap,
              })
            : null
        vaultCalldata = encodeWithdrawMarketRemovalBundle({
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

    setBusy(true)
    try {
      const { transactionUrl } = await proposeReallocateRemoveWithdrawQueueMultisigOnly({
        ethereum: window.ethereum as Eip1193Provider,
        provider,
        chainId,
        vaultAddress,
        ownerAddress,
        ownerKind,
        connectedAccount: account,
        vaultCalldata,
      })
      setSuccessUrl(transactionUrl)
    } catch (e) {
      setExecErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [
    provider,
    account,
    chainId,
    vaultAddress,
    ownerAddress,
    ownerKind,
    removeIndex,
    withdrawMarketStates,
    statesAligned,
    withdrawMarkets.length,
    amountToMove,
    destinations,
    supplyMap,
    capMap,
    alsoRemoveFromSupplyQueue,
    supplyQueueAddresses,
  ])

  const readyToRoute = removeIndex != null && headroomOk && removalPreconditionsOk && destinationsValid
  const hideUnselectedMoveButtons = readyToRoute && amountToMove > Z

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
    if (amountToMove > Z) {
      let allocs: MarketAllocationTuple[]
      if (destinations.length > 0) {
        try {
          allocs = buildReallocateAllocations({
            sourceMarket: removed.address,
            destinationMarkets: destinations,
            supplyAssetsByMarket: supplyMap,
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
    amountToMove,
    destinations,
    supplyMap,
    capMap,
    withdrawMarkets.length,
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
          {successUrl ? 'Close' : 'Cancel'}
        </button>
      </div>

      {ownerKind !== 'safe' ? (
        <p className="text-sm silo-alert silo-alert-error">
          This flow proposes transactions through a Safe. The vault owner must be a Gnosis Safe.
        </p>
      ) : null}

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
                        onChange={() => setRemoveIndex(i)}
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
                          <span className="text-xs font-mono tabular-nums silo-text-soft">{formatBal(st.supplyAssets)}</span>
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
                      <span className="text-xs font-mono tabular-nums silo-text-soft">
                        {formatBal(removedState.supplyAssets)}
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
                  setAlsoRemoveFromSupplyQueue(false)
                }}
              >
                Choose another market
              </button>

              {amountToMove > Z ? (
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
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold silo-text-main">{m.label}</span>
                              {m.siloConfigId !== undefined ? (
                                <span className="text-sm font-mono tabular-nums silo-text-soft">
                                  #{m.siloConfigId.toString()}
                                </span>
                              ) : null}
                              <span className="text-xs font-mono tabular-nums silo-text-soft">
                                {formatBal(st.supplyAssets)}
                              </span>
                            </div>
                            <p className="text-xs silo-text-main mt-0.5">
                              <span className="silo-text-soft">cap </span>
                              <span className="font-mono tabular-nums">{formatCapWhole(st.cap)}</span>
                            </p>
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

              {!headroomOk && amountToMove > Z && destinations.length > 0 ? (
                <p className="text-sm silo-alert silo-alert-error">
                  No single selected market has enough cap headroom for the full amount. Include a market that can absorb it
                  all (or remove liquidity from the source first).
                </p>
              ) : null}

              {vaultActionPreview ? (
                <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
                  <p className="text-sm font-medium silo-text-main">What the Safe will propose</p>
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

              <button
                type="button"
                disabled={!canExecute || !readyToRoute}
                onClick={() => void handleExecute()}
                className="silo-btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Signing proposal…' : 'Execute'}
              </button>
              {execErr ? <p className="text-sm silo-alert silo-alert-error">{execErr}</p> : null}

              {successUrl ? (
                <div className="pt-2 border-t border-[var(--silo-border)] flex flex-wrap items-center gap-2">
                  <a
                    href={successUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium silo-text-main hover:underline break-all"
                  >
                    Open Safe queue
                  </a>
                  <ShareLinkCopyButton url={successUrl} />
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
