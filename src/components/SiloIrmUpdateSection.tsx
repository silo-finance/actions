'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BrowserProvider } from 'ethers'
import CopyButton from '@/components/CopyButton'
import TransactionSuccessSummary from '@/components/TransactionSuccessSummary'
import ActionPermissionHint from '@/components/ActionPermissionHint'
import {
  executeDynamicKinkIrmAction,
  executeDynamicKinkIrmCancel,
  DYNAMIC_KINK_IRM_DENIED_MESSAGE,
  type DynamicKinkIrmActionSuccess,
} from '@/utils/dynamicKinkIrmAction'
import {
  classifyManageableOracleAction,
  type ManageableOracleAuthority,
} from '@/utils/manageableOracleAction'
import { type DynamicKinkIrmConfig, dynamicKinkIrmConfigToTuple } from '@/utils/dynamicKinkIrmConfig'
import {
  type DkinkIrmNamedPreset,
  fetchDkinkIrmPresets,
} from '@/utils/dkinkIrmPresetsClient'
import { flatRateCalculationPreview, flatRateToConfig, parseHumanPercentInput, SECONDS_IN_YEAR } from '@/utils/flatIrmRate'
import { getExplorerAddressUrl } from '@/utils/networks'
import type { OwnerKind } from '@/utils/ownerKind'
import { toUserErrorMessage } from '@/utils/rpcErrors'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import type { DynamicKinkIrmReadState } from '@/utils/dynamicKinkIrmReader'

type Props = {
  chainId: number
  siloIndex: number | null
  siloSymbol: string | null
  siloAddress: string
  interestRateModel: string
  irmState: DynamicKinkIrmReadState | null
  ownerKind: OwnerKind | null
  loading: boolean
  errorMessage: string | null
  provider: BrowserProvider | null
  eip1193Provider: Eip1193Provider | null
  connectedAccount: string
  onConfigChange: (siloKey: string, config: DynamicKinkIrmConfig | null) => void
  onActionSuccess: () => void
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function AddressLine({ chainId, address }: { chainId: number; address: string }) {
  const url = getExplorerAddressUrl(chainId, address)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm silo-text-main hover:underline"
        title={address}
      >
        {shortAddr(address)}
      </a>
      <CopyButton value={address} />
    </span>
  )
}

type Busy = 'idle' | 'updating' | 'cancelling'

function formatActivateAtUnix(seconds: bigint): { iso: string; unix: string } {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) {
    return { iso: '—', unix: String(seconds) }
  }
  try {
    const iso = new Date(n * 1000).toISOString().replace('T', ' ').replace('.000Z', 'Z')
    return { iso, unix: String(n) }
  } catch {
    return { iso: '—', unix: String(seconds) }
  }
}

export default function SiloIrmUpdateSection({
  chainId,
  siloIndex,
  siloSymbol,
  siloAddress,
  interestRateModel,
  irmState,
  ownerKind,
  loading,
  errorMessage,
  provider,
  eip1193Provider,
  connectedAccount,
  onConfigChange,
  onActionSuccess,
}: Props) {
  const siloKey = siloAddress.toLowerCase()
  const [busy, setBusy] = useState<Busy>('idle')
  const [txError, setTxError] = useState('')
  const [txSuccess, setTxSuccess] = useState<DynamicKinkIrmActionSuccess | null>(null)
  const [authority, setAuthority] = useState<ManageableOracleAuthority | null>(null)
  const [authorityLoading, setAuthorityLoading] = useState(false)

  const [presets, setPresets] = useState<DkinkIrmNamedPreset[] | null>(null)
  const [presetsError, setPresetsError] = useState<string | null>(null)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [presetFilter, setPresetFilter] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [flatMode, setFlatMode] = useState(false)
  const [flatPercentInput, setFlatPercentInput] = useState('')

  const siloName = siloIndex == null ? 'Silo' : `Silo${siloIndex}`
  const symbolSuffix = siloSymbol ? ` · ${siloSymbol}` : ''
  const title = `${siloName}${symbolSuffix} — interest rate model`

  useEffect(() => {
    setTxError('')
    setTxSuccess(null)
  }, [irmState?.irmAddress])

  useEffect(() => {
    if (!flatMode) return
    setSelectedPreset(null)
  }, [flatMode])

  useEffect(() => {
    if (flatMode) return
    setFlatPercentInput('')
  }, [flatMode])

  useEffect(() => {
    if (irmState?.pendingConfigExists) {
      onConfigChange(siloKey, null)
    }
  }, [irmState?.pendingConfigExists, siloKey, onConfigChange])

  useEffect(() => {
    let cancelled = false
    setPresetsLoading(true)
    setPresetsError(null)
    void (async () => {
      try {
        const list = await fetchDkinkIrmPresets()
        if (!cancelled) setPresets(list)
      } catch (e) {
        if (!cancelled) setPresetsError(toUserErrorMessage(e, 'Could not load preset list.'))
      } finally {
        if (!cancelled) setPresetsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredPresets = useMemo(() => {
    if (!presets) return []
    const q = presetFilter.trim().toLowerCase()
    if (!q) return presets
    return presets.filter((p) => p.name.toLowerCase().includes(q))
  }, [presets, presetFilter])

  const selectedConfig: DynamicKinkIrmConfig | null = useMemo(() => {
    if (flatMode) {
      const p = parseHumanPercentInput(flatPercentInput)
      if (p == null) return null
      try {
        return flatRateToConfig(p)
      } catch {
        return null
      }
    }
    if (!selectedPreset || !presets) return null
    const pr = presets.find((x) => x.name === selectedPreset)
    return pr?.config ?? null
  }, [flatMode, flatPercentInput, selectedPreset, presets])

  useEffect(() => {
    onConfigChange(siloKey, selectedConfig)
  }, [siloKey, selectedConfig, onConfigChange])

  const flatPreview = useMemo(() => {
    if (!flatMode) return null
    const p = parseHumanPercentInput(flatPercentInput)
    if (p == null) return null
    return flatRateCalculationPreview(p)
  }, [flatMode, flatPercentInput])

  useEffect(() => {
    if (!provider || !irmState?.owner || !ownerKind) {
      setAuthority(null)
      return
    }
    if (!connectedAccount) {
      setAuthority({ mode: 'denied', executingSafeAddress: null })
      return
    }
    if (!irmState.isDynamicKinkModel) {
      setAuthority(null)
      return
    }
    let cancelled = false
    setAuthorityLoading(true)
    void (async () => {
      try {
        const result = await classifyManageableOracleAction(
          provider,
          connectedAccount,
          irmState.owner!,
          ownerKind
        )
        if (!cancelled) setAuthority(result)
      } catch {
        if (!cancelled) setAuthority({ mode: 'denied', executingSafeAddress: null })
      } finally {
        if (!cancelled) setAuthorityLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [provider, irmState, ownerKind, connectedAccount])

  const runCancel = useCallback(async () => {
    if (!provider || !eip1193Provider || !connectedAccount || !irmState?.owner || !ownerKind) return
    if (!irmState.pendingConfigExists) return
    if (!irmState.isDynamicKinkModel) return
    setTxError('')
    setTxSuccess(null)
    setBusy('cancelling')
    try {
      const signer = await provider.getSigner()
      const result = await executeDynamicKinkIrmCancel({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        connectedAccount,
        irmAddress: interestRateModel,
        ownerAddress: irmState.owner,
        ownerKind,
      })
      setTxSuccess(result)
      onActionSuccess()
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy('idle')
    }
  }, [provider, eip1193Provider, connectedAccount, irmState, ownerKind, interestRateModel, chainId, onActionSuccess])

  const runUpdate = useCallback(async () => {
    if (!provider || !eip1193Provider || !connectedAccount || !irmState?.owner || !ownerKind) return
    if (!selectedConfig) return
    if (!irmState.isDynamicKinkModel) return
    if (irmState.pendingConfigExists) return
    setTxError('')
    setTxSuccess(null)
    setBusy('updating')
    try {
      const signer = await provider.getSigner()
      const result = await executeDynamicKinkIrmAction({
        ethereum: eip1193Provider,
        provider,
        signer,
        chainId,
        connectedAccount,
        call: { irmAddress: interestRateModel, config: selectedConfig },
        ownerAddress: irmState.owner,
        ownerKind,
      })
      setTxSuccess(result)
      onActionSuccess()
    } catch (e) {
      setTxError(toUserErrorMessage(e))
    } finally {
      setBusy('idle')
    }
  }, [
    provider,
    eip1193Provider,
    connectedAccount,
    irmState,
    ownerKind,
    selectedConfig,
    interestRateModel,
    chainId,
    onActionSuccess,
  ])

  const canSubmit =
    irmState?.isDynamicKinkModel === true &&
    irmState.owner &&
    !irmState.pendingConfigExists &&
    selectedConfig != null &&
    (authority?.mode === 'direct' || authority?.mode === 'safe_as_wallet' || authority?.mode === 'safe_propose')

  const canCancel =
    irmState?.isDynamicKinkModel === true &&
    irmState?.pendingConfigExists === true &&
    irmState.owner &&
    (authority?.mode === 'direct' || authority?.mode === 'safe_as_wallet' || authority?.mode === 'safe_propose')

  if (loading || !irmState) {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>
        {errorMessage ? (
          <p className="text-sm silo-alert silo-alert-error mt-3 m-0">{errorMessage}</p>
        ) : (
          <p className="text-sm silo-text-soft mt-3 m-0">Loading interest rate model…</p>
        )}
      </section>
    )
  }

  if (irmState.error) {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>
        <p className="text-sm silo-alert silo-alert-error mt-3 m-0">{irmState.error}</p>
      </section>
    )
  }

  if (!irmState.isDynamicKinkModel) {
    return (
      <section className="silo-panel p-5">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>
        <p className="text-sm silo-alert silo-alert-warning mt-3 m-0">
          This IRM is not a DynamicKinkModel ({irmState.versionString ?? 'unknown type'}) — use the Silo
          contracts repo for other types.
        </p>
        <p className="text-xs silo-text-soft m-0 mt-2">IRM: {shortAddr(irmState.irmAddress)}</p>
      </section>
    )
  }

  if (irmState.pendingConfigExists) {
    const { iso, unix } = irmState.activateConfigAt != null
      ? formatActivateAtUnix(irmState.activateConfigAt)
      : { iso: 'unavailable (read failed)', unix: '—' }
    return (
      <section className="silo-panel p-5 space-y-4">
        <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Dynamic kink IRM</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AddressLine chainId={chainId} address={irmState.irmAddress} />
            <span className="text-xs font-mono silo-text-main">
              {irmState.versionString ?? '(no VERSION)'}
            </span>
          </div>
        </div>

        <div className="space-y-1 rounded-md border border-[var(--silo-border)] bg-[var(--silo-surface)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">Pending config</p>
          <p className="text-sm silo-text-main m-0">
            A new config is in the timelock window. It becomes active at:
          </p>
          <p className="text-sm font-mono silo-text-main m-0">{iso}</p>
          {unix !== '—' ? (
            <p className="text-xs silo-text-soft m-0">
              Unix: <span className="font-mono">{unix}</span>
            </p>
          ) : null}
          <p className="text-xs silo-text-soft m-0 mt-2">
            You can submit another update only after the timelock, unless you cancel the pending config below.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Owner</p>
          {irmState.owner ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <AddressLine chainId={chainId} address={irmState.owner} />
              <span className="text-xs silo-text-main">
                <span className="silo-text-soft">·</span>{' '}
                <span className="font-medium">
                  {ownerKind === 'safe'
                    ? 'Safe (multisig)'
                    : ownerKind === 'eoa'
                      ? 'EOA'
                      : ownerKind === 'contract'
                        ? 'Contract'
                        : '—'}
                </span>
              </span>
            </div>
          ) : (
            <p className="text-sm silo-text-soft m-0">Owner not available.</p>
          )}
          {irmState.owner && ownerKind ? (
            <p className="text-xs m-0">
              {authorityLoading ? (
                <span className="silo-text-soft">Checking signer status…</span>
              ) : authority?.mode === 'safe_as_wallet' ? (
                <span className="silo-text-main">Connected wallet is this Safe (sends a Safe transaction).</span>
              ) : authority?.mode === 'safe_propose' ? (
                <span className="silo-text-main">You are a signer on this Safe.</span>
              ) : ownerKind === 'safe' && connectedAccount ? (
                <span className="silo-alert silo-alert-warning inline-block px-2 py-0.5 rounded">
                  You are not a signer on this Safe.
                </span>
              ) : null}
            </p>
          ) : null}
          {authority?.mode === 'denied' && !authorityLoading && irmState.owner && ownerKind ? (
            <p className="text-xs silo-alert silo-alert-error m-0 mt-1">{DYNAMIC_KINK_IRM_DENIED_MESSAGE}</p>
          ) : null}
        </div>

        {txError ? <p className="text-sm silo-alert silo-alert-error m-0">{txError}</p> : null}
        {txSuccess ? (
          <TransactionSuccessSummary
            url={txSuccess.transactionUrl}
            linkLabel={txSuccess.successLinkLabel}
            outcome={txSuccess.outcome}
          />
        ) : null}
        <ActionPermissionHint
          allowed={authority != null && authority.mode !== 'denied'}
          onlyForLabel="IRM contract owner (directly or as a Safe signer)"
          className="text-xs"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="silo-btn-primary"
            disabled={!canCancel || busy !== 'idle'}
            onClick={() => void runCancel()}
          >
            {busy === 'cancelling' ? 'Submitting…' : 'Cancel pending config'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="silo-panel p-5 space-y-4">
      <h2 className="text-lg font-semibold silo-text-main m-0">{title}</h2>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Dynamic kink IRM</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AddressLine chainId={chainId} address={irmState.irmAddress} />
          <span className="text-xs">
            <span className="silo-text-soft">·</span>{' '}
            <span className="font-mono silo-text-main">
              {irmState.versionString ?? '(no VERSION)'}
            </span>
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft mb-0.5">Owner</p>
        {irmState.owner ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AddressLine chainId={chainId} address={irmState.owner} />
            <span className="text-xs silo-text-main">
              <span className="silo-text-soft">·</span>{' '}
              <span className="font-medium">
                {ownerKind === 'safe'
                  ? 'Safe (multisig)'
                  : ownerKind === 'eoa'
                    ? 'EOA'
                    : ownerKind === 'contract'
                      ? 'Contract'
                      : '—'}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-sm silo-text-soft m-0">Owner not available.</p>
        )}
        {irmState.owner && ownerKind ? (
          <p className="text-xs m-0">
            {authorityLoading ? (
              <span className="silo-text-soft">Checking signer status…</span>
            ) : authority?.mode === 'safe_as_wallet' ? (
              <span className="silo-text-main">Connected wallet is this Safe (sends a Safe transaction).</span>
            ) : authority?.mode === 'safe_propose' ? (
              <span className="silo-text-main">You are a signer on this Safe.</span>
            ) : ownerKind === 'safe' && connectedAccount ? (
              <span className="silo-alert silo-alert-warning inline-block px-2 py-0.5 rounded">
                You are not a signer on this Safe.
              </span>
            ) : null}
          </p>
        ) : null}
        {authority?.mode === 'denied' && !authorityLoading && irmState.owner && ownerKind ? (
          <p className="text-xs silo-alert silo-alert-error m-0 mt-1">{DYNAMIC_KINK_IRM_DENIED_MESSAGE}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="accent-[var(--silo-accent,currentColor)]"
            checked={flatMode}
            onChange={(e) => setFlatMode(e.target.checked)}
          />
          <span className="silo-text-main font-medium">Flat annual rate (constant borrow APR)</span>
        </label>

        {!flatMode ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0">Presets (remote list)</p>
            <input
              type="search"
              value={presetFilter}
              onChange={(e) => setPresetFilter(e.target.value)}
              placeholder="Filter by name…"
              className="w-full silo-input silo-input--sm font-mono"
              disabled={presetsLoading}
            />
            {presetsLoading ? (
              <p className="text-sm silo-text-soft m-0">Loading presets…</p>
            ) : presetsError ? (
              <p className="text-sm silo-alert silo-alert-error m-0">{presetsError}</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto border border-[var(--silo-border)] rounded-md divide-y divide-[var(--silo-border)] m-0 p-0 list-none">
                {filteredPresets.map((p) => (
                  <li key={p.name}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm silo-text-main hover:bg-[var(--silo-surface)] data-[sel=true]:font-semibold"
                      data-sel={selectedPreset === p.name ? 'true' : 'false'}
                      onClick={() => setSelectedPreset(p.name)}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide silo-text-soft">Annual rate (%)</label>
            <input
              value={flatPercentInput}
              onChange={(e) => setFlatPercentInput(e.target.value)}
              placeholder="0–100, e.g. 5.07 or 0,2"
              className="w-full silo-input silo-input--md font-mono"
            />
            {flatPreview && flatMode ? (
              <p className="text-xs silo-text-soft m-0">
                Annual = (percent/100) × 1e18 = <span className="font-mono silo-text-main">{String(flatPreview.annualRateWad)}</span> WAD;{' '}
                r<sub>min</sub> = annual / {String(SECONDS_IN_YEAR)}s per year
              </p>
            ) : null}
            {flatMode && selectedConfig ? (
              <ConfigPreview config={selectedConfig} />
            ) : null}
          </div>
        )}

        {!flatMode && selectedConfig ? <ConfigPreview config={selectedConfig} /> : null}
      </div>

      {txError ? <p className="text-sm silo-alert silo-alert-error m-0">{txError}</p> : null}
      {txSuccess ? (
        <TransactionSuccessSummary
          url={txSuccess.transactionUrl}
          linkLabel={txSuccess.successLinkLabel}
          outcome={txSuccess.outcome}
        />
      ) : null}
      <ActionPermissionHint
        allowed={authority != null && authority.mode !== 'denied'}
        onlyForLabel="IRM contract owner (directly or as a Safe signer)"
        className="text-xs"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="silo-btn-primary"
          disabled={!canSubmit || busy !== 'idle'}
          onClick={() => void runUpdate()}
        >
          {busy === 'updating' ? 'Submitting…' : 'Update IRM config'}
        </button>
      </div>
    </section>
  )
}

function ConfigPreview({ config }: { config: DynamicKinkIrmConfig }) {
  const t = dynamicKinkIrmConfigToTuple(config)
  const keys: (keyof DynamicKinkIrmConfig)[] = [
    'ulow',
    'u1',
    'u2',
    'ucrit',
    'rmin',
    'kmin',
    'kmax',
    'alpha',
    'cminus',
    'cplus',
    'c1',
    'c2',
    'dmax',
  ]
  return (
    <div className="rounded-md border border-[var(--silo-border)] p-3 overflow-x-auto">
      <p className="text-xs font-semibold uppercase tracking-wide silo-text-soft m-0 mb-2">Config tuple</p>
      <table className="w-full text-xs font-mono">
        <tbody>
          {keys.map((k, i) => (
            <tr key={k}>
              <td className="pr-2 silo-text-soft align-top py-0.5">{k}</td>
              <td className="silo-text-main break-all py-0.5">{String(t[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
