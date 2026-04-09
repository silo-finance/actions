'use client'

import { formatUnits, getAddress } from 'ethers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CopyButton from '@/components/CopyButton'
import MarketItem from '@/components/MarketItem'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import { useWeb3 } from '@/contexts/Web3Context'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { normalizeAddress } from '@/utils/addressValidation'
import { readErc4626Asset } from '@/utils/readErc4626Asset'
import { resolveMarketLabel, type ResolvedMarket } from '@/utils/resolveVaultMarket'
import {
  canConnectedAccountCallSetSupplyQueue,
  SET_SUPPLY_QUEUE_ROLES_DESCRIPTION,
} from '@/utils/connectedVaultRole'
import { formatAcceptCapArgsCopy, formatSetSupplyQueueArgsCopy } from '@/utils/formatVaultActionCopyArgs'
import { setSupplyQueueForOwner } from '@/utils/setVaultSupplyQueue'
import type { OwnerKind } from '@/utils/ownerKind'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'
import {
  formatVaultAmountWholeTokens,
  type VaultUnderlyingMeta,
} from '@/utils/vaultReader'
import { fetchVaultMarketStates, type WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'

type Props = {
  title: string
  count?: number
  chainId: number
  items: ResolvedMarket[]
  loading?: boolean
  emptyMessage?: string
  hasLoaded: boolean
  vaultAddress: string
  vaultUnderlyingMeta: VaultUnderlyingMeta | null
  ownerAddress: string
  curatorAddress: string
  ownerKind: OwnerKind
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function formatUnderlyingAmount(value: bigint, decimals: number, symbol: string): string {
  const raw = formatUnits(value, decimals)
  if (!raw.includes('.')) return `${raw} ${symbol}`
  const [intPart, frac = ''] = raw.split('.')
  const fracTrim = frac.replace(/0+$/, '')
  if (fracTrim === '') return `${intPart} ${symbol}`
  return `${intPart}.${fracTrim} ${symbol}`
}

function addressesEqualList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    try {
      if (getAddress(a[i]) !== getAddress(b[i])) return false
    } catch {
      return false
    }
  }
  return true
}

/** Resolve `kind` for an address already present in the draft queue (parent Check + in-session resolves). */
function marketKindForQueueAddress(
  addr: string,
  items: ResolvedMarket[],
  extraResolved: Map<string, ResolvedMarket>
): ResolvedMarket['kind'] {
  let norm: string
  try {
    norm = getAddress(addr).toLowerCase()
  } catch {
    return 'Unknown'
  }
  const fromItems = items.find((m) => {
    try {
      return getAddress(m.address).toLowerCase() === norm
    } catch {
      return false
    }
  })
  if (fromItems) return fromItems.kind
  return extraResolved.get(norm)?.kind ?? 'Unknown'
}

/** Insert new markets before the first IdleVault when one exists; otherwise append. */
function indexBeforeFirstIdleVault(
  order: string[],
  items: ResolvedMarket[],
  extraResolved: Map<string, ResolvedMarket>
): number {
  for (let i = 0; i < order.length; i++) {
    if (marketKindForQueueAddress(order[i], items, extraResolved) === 'IdleVault') {
      return i
    }
  }
  return order.length
}

export default function SupplyQueueColumn({
  title,
  count: countProp,
  chainId,
  items,
  loading,
  emptyMessage = 'No markets',
  hasLoaded,
  vaultAddress,
  vaultUnderlyingMeta,
  ownerAddress,
  curatorAddress,
  ownerKind,
}: Props) {
  const { provider, account, isConnected } = useWeb3()
  const [editOrder, setEditOrder] = useState<string[]>([])
  const [baselineOrder, setBaselineOrder] = useState<string[]>([])
  const [reorderUnlocked, setReorderUnlocked] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [addRowOpen, setAddRowOpen] = useState(false)
  const [addStatus, setAddStatus] = useState<
    | 'idle'
    | 'checking'
    | 'success'
    | 'mismatch'
    | 'duplicate'
    | 'invalid'
    | 'rpc_error'
    | 'no_cap'
  >('idle')
  const [chainNowSec, setChainNowSec] = useState<bigint | null>(null)
  const [queueStates, setQueueStates] = useState<WithdrawMarketOnchainState[]>([])
  const [extraResolved, setExtraResolved] = useState<Map<string, ResolvedMarket>>(new Map())
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [txSuccess, setTxSuccess] = useState<{
    url: string
    linkLabel: string
    outcome: TxSubmitOutcome
  } | null>(null)
  const [mutationAllowed, setMutationAllowed] = useState<boolean | null>(null)
  const [permissionGateLoading, setPermissionGateLoading] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  /** Lowercased checksum keys — rows stay in `editOrder` but are excluded from the submitted queue until restored. */
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  const resolvingRef = useRef<Set<string>>(new Set())
  const itemsForInsertRef = useRef(items)
  itemsForInsertRef.current = items
  const extraResolvedForInsertRef = useRef(extraResolved)
  extraResolvedForInsertRef.current = extraResolved

  const vaultAsset = vaultUnderlyingMeta?.address ?? null
  const itemsKey = useMemo(
    () =>
      items
        .map((m) => {
          try {
            return getAddress(m.address).toLowerCase()
          } catch {
            return m.address.toLowerCase()
          }
        })
        .join(','),
    [items]
  )

  useEffect(() => {
    resolvingRef.current.clear()
    const next = items.map((m) => {
      try {
        return getAddress(m.address)
      } catch {
        return m.address
      }
    })
    setEditOrder(next)
    setBaselineOrder(next)
    setReorderUnlocked(false)
    setAddInput('')
    setAddStatus('idle')
    setAddRowOpen(false)
    setExtraResolved(new Map())
    setLocalError('')
    setTxSuccess(null)
    setMutationAllowed(null)
    setPermissionError('')
    setRemovedKeys([])
  }, [vaultAddress, itemsKey])

  useEffect(() => {
    if (!hasLoaded || !provider || !account || !vaultAddress) {
      setMutationAllowed(null)
      return
    }
    let cancelled = false
    void canConnectedAccountCallSetSupplyQueue(
      provider,
      vaultAddress,
      account,
      { owner: ownerAddress, curator: curatorAddress },
      ownerKind
    ).then((ok) => {
      if (!cancelled) setMutationAllowed(ok)
    })
    return () => {
      cancelled = true
    }
  }, [hasLoaded, provider, account, vaultAddress, ownerAddress, curatorAddress, ownerKind])

  const editOrderKey = useMemo(
    () =>
      editOrder
        .map((a) => {
          try {
            return getAddress(a).toLowerCase()
          } catch {
            return a.toLowerCase()
          }
        })
        .join(','),
    [editOrder]
  )

  useEffect(() => {
    if (!provider || !hasLoaded || editOrder.length === 0) {
      setQueueStates([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const st = await fetchVaultMarketStates(provider, vaultAddress, editOrder)
        if (!cancelled) setQueueStates(st)
      } catch {
        if (!cancelled) setQueueStates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, vaultAddress, hasLoaded, editOrderKey])

  useEffect(() => {
    if (!provider) return
    let cancelled = false
    void provider.getBlock('latest').then((b) => {
      if (!cancelled && b != null) setChainNowSec(BigInt(b.timestamp))
    })
    return () => {
      cancelled = true
    }
  }, [provider, editOrderKey, queueStates])

  useEffect(() => {
    if (!provider || !hasLoaded || !vaultAsset) return
    for (const addr of editOrder) {
      let norm: string
      try {
        norm = getAddress(addr)
      } catch {
        continue
      }
      const inItems = items.some((m) => {
        try {
          return getAddress(m.address) === norm
        } catch {
          return false
        }
      })
      if (inItems) continue
      const k = norm.toLowerCase()
      if (resolvingRef.current.has(k)) continue
      resolvingRef.current.add(k)
      const cache = new Map<string, ResolvedMarket>()
      void resolveMarketLabel(provider, norm, vaultAddress, cache, vaultUnderlyingMeta).then((r) => {
        resolvingRef.current.delete(k)
        setExtraResolved((prev) => {
          if (prev.has(k)) return prev
          const n = new Map(prev)
          n.set(k, r)
          return n
        })
      })
    }
  }, [provider, vaultAddress, hasLoaded, vaultAsset, vaultUnderlyingMeta, editOrderKey, items])

  const stateByAddr = useMemo(() => {
    const m = new Map<string, WithdrawMarketOnchainState>()
    for (const s of queueStates) {
      m.set(s.address.toLowerCase(), s)
    }
    return m
  }, [queueStates])

  const removedSet = useMemo(() => new Set(removedKeys), [removedKeys])

  const effectiveOrder = useMemo(() => {
    return editOrder.filter((a) => {
      try {
        return !removedSet.has(getAddress(a).toLowerCase())
      } catch {
        return !removedSet.has(a.toLowerCase())
      }
    })
  }, [editOrder, removedSet])

  const normList = useCallback((addrs: string[]) => {
    return addrs.map((a) => {
      try {
        return getAddress(a)
      } catch {
        return a
      }
    })
  }, [])

  const capsOk =
    chainNowSec != null &&
    queueStates.length === editOrder.length &&
    (effectiveOrder.length === 0 ||
      effectiveOrder.every((addr) => {
        let k: string
        try {
          k = getAddress(addr).toLowerCase()
        } catch {
          return false
        }
        const st = stateByAddr.get(k)
        if (!st) return false
        if (st.cap > BigInt(0)) return true
        return st.pendingCapValue > BigInt(0) && st.pendingCapValidAt <= chainNowSec
      }))

  const capTimelockBlocksSubmit =
    chainNowSec != null &&
    queueStates.length === editOrder.length &&
    effectiveOrder.some((addr) => {
      let k: string
      try {
        k = getAddress(addr).toLowerCase()
      } catch {
        return false
      }
      const st = stateByAddr.get(k)
      if (!st) return false
      return (
        st.cap === BigInt(0) &&
        st.pendingCapValue > BigInt(0) &&
        st.pendingCapValidAt > chainNowSec
      )
    })

  const isDirty = !addressesEqualList(normList(effectiveOrder), normList(baselineOrder))

  const canAttempt =
    isConnected &&
    provider != null &&
    typeof window !== 'undefined' &&
    window.ethereum != null &&
    (ownerKind === 'eoa' || ownerKind === 'safe' || ownerKind === 'contract')

  const verifyCanMutateSupplyQueue = useCallback(async (): Promise<boolean> => {
    if (!provider || !account || !vaultAddress) return false
    return canConnectedAccountCallSetSupplyQueue(
      provider,
      vaultAddress,
      account,
      { owner: ownerAddress, curator: curatorAddress },
      ownerKind
    )
  }, [provider, account, vaultAddress, ownerAddress, curatorAddress, ownerKind])

  const handleAddMarketClick = useCallback(async () => {
    setPermissionError('')
    if (!isConnected || !account) {
      setPermissionError('Connect a wallet first.')
      return
    }
    if (!provider || !vaultAddress) return
    setPermissionGateLoading(true)
    try {
      const ok = await verifyCanMutateSupplyQueue()
      if (!ok) {
        setPermissionError(
          `You do not have permission to add or change the supply queue. Only ${SET_SUPPLY_QUEUE_ROLES_DESCRIPTION}`
        )
        setMutationAllowed(false)
        return
      }
      setMutationAllowed(true)
      setAddRowOpen(true)
    } finally {
      setPermissionGateLoading(false)
    }
  }, [isConnected, account, provider, vaultAddress, verifyCanMutateSupplyQueue])

  const handleChangeOrderClick = useCallback(async () => {
    setPermissionError('')
    if (!isConnected || !account) {
      setPermissionError('Connect a wallet first.')
      return
    }
    if (!provider || !vaultAddress) return
    setPermissionGateLoading(true)
    try {
      const ok = await verifyCanMutateSupplyQueue()
      if (!ok) {
        setPermissionError(
          `You do not have permission to reorder the supply queue. Only ${SET_SUPPLY_QUEUE_ROLES_DESCRIPTION}`
        )
        setMutationAllowed(false)
        return
      }
      setMutationAllowed(true)
      setTxSuccess(null)
      setReorderUnlocked(true)
    } finally {
      setPermissionGateLoading(false)
    }
  }, [isConnected, account, provider, vaultAddress, verifyCanMutateSupplyQueue])

  const showReorder = reorderUnlocked && editOrder.length >= 2

  useEffect(() => {
    if (!provider || !vaultAsset || !addRowOpen) {
      return
    }
    const trimmed = addInput.trim()
    if (trimmed.length === 0) {
      setAddStatus((s) => (s === 'success' ? s : 'idle'))
      return
    }
    const norm = normalizeAddress(trimmed)
    if (!norm) {
      setAddStatus('invalid')
      return
    }

    let cancelled = false
    setAddStatus('checking')
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const marketAsset = await readErc4626Asset(provider, norm)
          if (cancelled) return
          if (marketAsset == null) {
            setAddStatus('rpc_error')
            return
          }
          if (marketAsset !== vaultAsset) {
            setAddStatus('mismatch')
            return
          }
          const [st] = await fetchVaultMarketStates(provider, vaultAddress, [norm])
          if (cancelled) return
          const hasCapOrPending = st.cap > BigInt(0) || st.pendingCapValue > BigInt(0)
          if (!hasCapOrPending) {
            setAddStatus('no_cap')
            return
          }
          setEditOrder((prev) => {
            if (prev.some((a) => getAddress(a) === norm)) {
              queueMicrotask(() => setAddStatus('duplicate'))
              return prev
            }
            const insertAt = indexBeforeFirstIdleVault(
              prev,
              itemsForInsertRef.current,
              extraResolvedForInsertRef.current
            )
            const next = [...prev]
            next.splice(insertAt, 0, norm)
            queueMicrotask(() => {
              setReorderUnlocked(true)
              setAddInput('')
              setAddStatus('success')
              window.setTimeout(() => setAddStatus('idle'), 2200)
            })
            return next
          })
        } catch {
          if (!cancelled) setAddStatus('rpc_error')
        }
      })()
    }, 450)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [addInput, addRowOpen, provider, vaultAsset, vaultAddress])

  const moveUp = useCallback((i: number) => {
    if (i <= 0) return
    setEditOrder((prev) => {
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })
  }, [])

  const moveDown = useCallback((i: number) => {
    setEditOrder((prev) => {
      if (i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }, [])

  const handleCancelEdits = useCallback(() => {
    setEditOrder(
      baselineOrder.map((a) => {
        try {
          return getAddress(a)
        } catch {
          return a
        }
      })
    )
    setRemovedKeys([])
    setReorderUnlocked(false)
    setAddRowOpen(false)
    setAddInput('')
    setAddStatus('idle')
    setPermissionError('')
    setLocalError('')
    setTxSuccess(null)
  }, [baselineOrder])

  const markRowRemoved = useCallback((addr: string) => {
    try {
      const k = getAddress(addr).toLowerCase()
      setRemovedKeys((prev) => (prev.includes(k) ? prev : [...prev, k]))
    } catch {
      const k = addr.toLowerCase()
      setRemovedKeys((prev) => (prev.includes(k) ? prev : [...prev, k]))
    }
  }, [])

  const restoreRow = useCallback((addr: string) => {
    try {
      const k = getAddress(addr).toLowerCase()
      setRemovedKeys((prev) => prev.filter((x) => x !== k))
    } catch {
      const k = addr.toLowerCase()
      setRemovedKeys((prev) => prev.filter((x) => x !== k))
    }
  }, [])

  /** Newly added row (not from last Check): drop from list instead of soft-remove. */
  const removeDraftMarket = useCallback((addr: string) => {
    let k: string
    try {
      k = getAddress(addr).toLowerCase()
    } catch {
      k = addr.toLowerCase()
    }
    setEditOrder((prev) =>
      prev.filter((a) => {
        try {
          return getAddress(a).toLowerCase() !== k
        } catch {
          return a.toLowerCase() !== k
        }
      })
    )
    setRemovedKeys((prev) => prev.filter((x) => x !== k))
    setExtraResolved((prev) => {
      if (!prev.has(k)) return prev
      const n = new Map(prev)
      n.delete(k)
      return n
    })
  }, [])

  const lookupRow = useCallback(
    (addr: string): ResolvedMarket => {
      let norm: string
      try {
        norm = getAddress(addr)
      } catch {
        return { address: addr, label: shortAddr(addr), kind: 'Unknown' }
      }
      const fromItems = items.find((m) => {
        try {
          return getAddress(m.address) === norm
        } catch {
          return false
        }
      })
      if (fromItems) return fromItems
      const ex = extraResolved.get(norm.toLowerCase())
      if (ex) return ex
      return { address: norm, label: shortAddr(norm), kind: 'Unknown' }
    },
    [items, extraResolved]
  )

  const rowDerived = useCallback(
    (addr: string, rm: ResolvedMarket) => {
      let normKey: string
      try {
        normKey = getAddress(addr).toLowerCase()
      } catch {
        return { positionLabel: rm.positionLabel, capLabel: rm.capLabel }
      }
      const st = stateByAddr.get(normKey)
      const u = vaultUnderlyingMeta
      if (!st || !u) {
        return { positionLabel: rm.positionLabel, capLabel: rm.capLabel }
      }
      const positionLabel =
        rm.positionLabel ?? formatUnderlyingAmount(st.supplyAssets, u.decimals, u.symbol)

      let capLabel = rm.capLabel
      if (capLabel == null) {
        if (st.cap > BigInt(0)) {
          capLabel = formatVaultAmountWholeTokens(st.cap, u)
        } else if (st.pendingCapValue > BigInt(0)) {
          const p = formatVaultAmountWholeTokens(st.pendingCapValue, u)
          const waiting =
            chainNowSec != null && st.pendingCapValidAt > chainNowSec
          capLabel = `${p} — pending cap${waiting ? ' (timelock)' : ''}`
        }
      }

      return { positionLabel, capLabel }
    },
    [stateByAddr, vaultUnderlyingMeta, chainNowSec]
  )

  const isDraftSupplyMarket = useCallback(
    (addr: string) => {
      let norm: string
      try {
        norm = getAddress(addr)
      } catch {
        return false
      }
      return !items.some((m) => {
        try {
          return getAddress(m.address) === norm
        } catch {
          return false
        }
      })
    },
    [items]
  )

  const handleSetSupplyQueue = useCallback(async () => {
    setLocalError('')
    setTxSuccess(null)
    if (!provider || !account || !window.ethereum) {
      setLocalError('Wallet not available.')
      return
    }
    if (!capsOk) {
      setLocalError(
        'Every market needs an active supply cap or a pending cap whose timelock has elapsed (acceptCap will run first in the batch).'
      )
      return
    }
    if (!isDirty) {
      setLocalError('Change the queue, add markets, or mark markets for removal before submitting.')
      return
    }
    setBusy(true)
    try {
      const signer = await provider.getSigner()
      const latest = await provider.getBlock('latest')
      const now = latest != null ? BigInt(latest.timestamp) : BigInt(Math.floor(Date.now() / 1000))

      const marketsToAcceptCapFirst: string[] = []
      for (const addr of effectiveOrder) {
        const st = stateByAddr.get(getAddress(addr).toLowerCase())
        if (
          st != null &&
          st.cap === BigInt(0) &&
          st.pendingCapValue > BigInt(0) &&
          st.pendingCapValidAt <= now
        ) {
          marketsToAcceptCapFirst.push(getAddress(st.address))
        }
      }

      const submitted = effectiveOrder.map((a) => getAddress(a))

      const { transactionUrl, successLinkLabel: label, outcome } = await setSupplyQueueForOwner({
        ethereum: window.ethereum as Eip1193Provider,
        provider,
        signer,
        chainId,
        vaultAddress,
        ownerAddress,
        curatorAddress,
        ownerKind,
        connectedAccount: account,
        newSupplyQueue: submitted,
        marketsToAcceptCapFirst,
      })
      setTxSuccess({ url: transactionUrl, linkLabel: label, outcome })
      setEditOrder(submitted)
      setBaselineOrder(submitted)
      setRemovedKeys([])
      setReorderUnlocked(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLocalError(msg || 'Could not complete the request.')
    } finally {
      setBusy(false)
    }
  }, [
    provider,
    account,
    chainId,
    vaultAddress,
    ownerAddress,
    curatorAddress,
    ownerKind,
    effectiveOrder,
    stateByAddr,
    capsOk,
    isDirty,
    queueStates,
  ])

  const displayCount =
    hasLoaded ? editOrder.length : countProp !== undefined ? countProp : null
  const heading = displayCount !== null ? `${title} (${displayCount})` : title

  const showSubmitSection = reorderUnlocked && isDirty && hasLoaded

  const submitButtonDisabled =
    !canAttempt || busy || mutationAllowed === false || !capsOk || capTimelockBlocksSubmit

  const supplyQueueActionPreview = useMemo(() => {
    if (!showSubmitSection) return null
    if (queueStates.length !== editOrder.length) return null

    const nowForPreview = chainNowSec ?? BigInt(Math.floor(Date.now() / 1000))

    type Step = { id: string; method: string; argLabel: string; copyValue: string }
    const steps: Step[] = []

    const acceptMarkets: string[] = []
    for (const addr of effectiveOrder) {
      let k: string
      try {
        k = getAddress(addr).toLowerCase()
      } catch {
        continue
      }
      const st = stateByAddr.get(k)
      if (
        st != null &&
        st.cap === BigInt(0) &&
        st.pendingCapValue > BigInt(0) &&
        st.pendingCapValidAt <= nowForPreview
      ) {
        acceptMarkets.push(getAddress(st.address))
      }
    }

    for (const m of acceptMarkets) {
      steps.push({
        id: `acceptCap-${m}`,
        method: 'acceptCap',
        argLabel: '_market (contract IERC4626)',
        copyValue: formatAcceptCapArgsCopy(m),
      })
    }

    const queueAddrs = effectiveOrder.map((a) => getAddress(a))
    steps.push({
      id: 'setSupplyQueue',
      method: 'setSupplyQueue',
      argLabel: '_newSupplyQueue (address[])',
      copyValue: formatSetSupplyQueueArgsCopy(queueAddrs),
    })

    return steps
  }, [
    showSubmitSection,
    queueStates.length,
    editOrder.length,
    effectiveOrder,
    stateByAddr,
    chainNowSec,
  ])

  const editorActive =
    hasLoaded &&
    vaultAsset &&
    mutationAllowed === true &&
    (reorderUnlocked || isDirty || addRowOpen || removedKeys.length > 0)

  const showCancel =
    hasLoaded &&
    vaultAsset &&
    (isDirty || addRowOpen || reorderUnlocked || removedKeys.length > 0)

  return (
    <div className="silo-panel silo-top-card p-5 h-full min-h-[200px]">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <h2 className="text-lg font-semibold silo-text-main">{heading}</h2>
        {showCancel ? (
          <button
            type="button"
            onClick={handleCancelEdits}
            disabled={busy}
            className="text-xs font-medium silo-text-soft hover:silo-text-main underline shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        ) : hasLoaded && editOrder.length >= 1 && !reorderUnlocked ? (
          <button
            type="button"
            className="text-xs font-medium silo-text-soft hover:silo-text-main underline shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={mutationAllowed === false || permissionGateLoading}
            onClick={() => void handleChangeOrderClick()}
          >
            {permissionGateLoading ? 'Checking access…' : editOrder.length >= 2 ? 'Change order' : 'Edit queue'}
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm silo-text-soft">Loading…</p>
      ) : !hasLoaded ? (
        <p className="text-sm silo-text-soft">{emptyMessage}</p>
      ) : editOrder.length === 0 && !addRowOpen ? (
        <p className="text-sm silo-text-soft mb-3">{emptyMessage}</p>
      ) : (
        <div className="mb-3 space-y-1">
          {editOrder.map((addr, i) => {
            const rm = lookupRow(addr)
            const { positionLabel, capLabel } = rowDerived(addr, rm)
            let rowKey: string
            try {
              rowKey = getAddress(addr).toLowerCase()
            } catch {
              rowKey = addr.toLowerCase()
            }
            const marked = removedSet.has(rowKey)
            return (
              <div key={`${addr}-${i}`} className="flex items-stretch gap-2 min-w-0">
                <div
                  className={`min-w-0 flex-1 rounded-lg transition-[opacity,filter] ${
                    marked ? 'silo-market-row--removed' : ''
                  }`}
                >
                  <MarketItem
                    index={i}
                    chainId={chainId}
                    address={rm.address}
                    label={rm.label}
                    positionLabel={positionLabel}
                    siloConfigId={rm.siloConfigId}
                    capLabel={capLabel}
                    highlightNew={!marked && isDraftSupplyMarket(addr)}
                    reorder={
                      showReorder && !marked
                        ? {
                            onUp: () => moveUp(i),
                            onDown: () => moveDown(i),
                            disableUp: i === 0,
                            disableDown: i === editOrder.length - 1,
                          }
                        : undefined
                    }
                  />
                </div>
                {editorActive ? (
                  <div className="flex flex-col justify-center shrink-0 py-2">
                    {marked ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[11px] font-medium silo-text-soft whitespace-nowrap">Removed</span>
                        <button
                          type="button"
                          onClick={() => restoreRow(addr)}
                          className="text-xs font-medium silo-text-soft hover:silo-text-main underline whitespace-nowrap"
                        >
                          Undo
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          isDraftSupplyMarket(addr)
                            ? removeDraftMarket(addr)
                            : markRowRemoved(addr)
                        }
                        className="silo-inline-dismiss"
                        aria-label="Remove from draft queue"
                        title="Remove from draft queue"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {hasLoaded && vaultAsset ? (
        <div className="border-t border-[var(--silo-border)] pt-3 space-y-3">
          {permissionError ? (
            <p className="text-xs silo-alert silo-alert-error">{permissionError}</p>
          ) : null}
          <div className="w-full">
          {!addRowOpen ? (
            <button
              type="button"
              onClick={() => void handleAddMarketClick()}
              disabled={mutationAllowed === false || permissionGateLoading}
              className="silo-btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add market"
            >
              <span className="text-base leading-none" aria-hidden>
                +
              </span>
              {permissionGateLoading ? 'Checking access…' : 'Add market'}
            </button>
          ) : (
            <div className="space-y-2 w-full">
              <div className="relative w-full">
                <input
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  placeholder="0x… market vault"
                  className="w-full silo-input silo-input--md pr-10 font-mono text-sm focus:outline-none focus:ring-0"
                  aria-label="Market contract address"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAddInput('')
                    setAddStatus('idle')
                    setPermissionError('')
                    setAddRowOpen(false)
                  }}
                  className="silo-inline-dismiss absolute right-1 top-1/2 -translate-y-1/2"
                  aria-label="Close add row"
                  title="Close"
                >
                  ×
                </button>
              </div>
              {addStatus === 'checking' ? (
                <p className="text-xs silo-text-soft">Checking asset…</p>
              ) : null}
              {addStatus === 'success' ? (
                <p className="text-xs silo-text-main">Assets match.</p>
              ) : null}
              {addStatus === 'mismatch' ? (
                <p className="text-xs silo-alert silo-alert-error">
                  Underlying asset does not match this vault. This market cannot be used.
                </p>
              ) : null}
              {addStatus === 'duplicate' ? (
                <p className="text-xs silo-alert silo-alert-error">This market is already in the queue.</p>
              ) : null}
              {addStatus === 'invalid' ? (
                <p className="text-xs silo-alert silo-alert-error">Enter a valid address.</p>
              ) : null}
              {addStatus === 'rpc_error' ? (
                <p className="text-xs silo-alert silo-alert-error">
                  Could not read asset() from this contract.
                </p>
              ) : null}
              {addStatus === 'no_cap' ? (
                <p className="text-xs silo-alert silo-alert-error">
                  This market has no supply cap and no pending cap on the vault. A curator must submit a cap before it
                  can be added to the supply queue.
                </p>
              ) : null}
            </div>
          )}
          </div>

          {showSubmitSection ? (
            <div className="pt-2 space-y-2">
              <button
                type="button"
                disabled={submitButtonDisabled}
                onClick={() => void handleSetSupplyQueue()}
                className="silo-btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? 'Waiting for wallet…' : 'Set supply queue'}
              </button>
              {busy ? (
                <p className="text-xs silo-text-soft m-0">
                  {ownerKind === 'safe'
                    ? 'Approve the signature in your wallet to submit the multisig proposal.'
                    : 'Confirm in your wallet to send the vault update on-chain.'}
                </p>
              ) : null}
              {supplyQueueActionPreview ? (
                <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
                  <p className="text-sm font-medium silo-text-main">What the Safe will propose</p>
                  <ol className="list-decimal list-outside space-y-4 text-sm silo-text-main m-0 pl-5 sm:pl-6">
                    {supplyQueueActionPreview.map((s) => (
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
              {localError ? <p className="text-sm silo-alert silo-alert-error">{localError}</p> : null}
            </div>
          ) : null}

          {txSuccess ? (
            <div className="pt-2">
              <TransactionSuccessSummary
                url={txSuccess.url}
                linkLabel={txSuccess.linkLabel}
                outcome={txSuccess.outcome}
              />
            </div>
          ) : null}

          {reorderUnlocked && isDirty && hasLoaded && effectiveOrder.length > 0 && capTimelockBlocksSubmit ? (
            <p className="text-xs silo-alert silo-alert-error">
              A pending supply cap is still in timelock. Wait until it can be accepted; then submit — acceptCap for each
              such market runs first in the Safe batch, followed by set supply queue.
            </p>
          ) : null}
          {reorderUnlocked &&
          isDirty &&
          hasLoaded &&
          effectiveOrder.length > 0 &&
          !capsOk &&
          !capTimelockBlocksSubmit &&
          queueStates.length > 0 ? (
            <p className="text-xs silo-alert silo-alert-error">
              Every market needs an active cap or a pending cap whose timelock has elapsed before you can submit.
            </p>
          ) : null}
        </div>
      ) : hasLoaded ? (
        <p className="text-xs silo-text-soft pt-2">Run Check with vault connected to validate new markets (underlying asset).</p>
      ) : null}
    </div>
  )
}
