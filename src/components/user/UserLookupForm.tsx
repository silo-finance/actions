'use client'

type Props = {
  userValue: string
  addressValue: string
  onUserChange: (value: string) => void
  onAddressChange: (value: string) => void
  onSubmit: () => void
  loading: boolean
  error: string | null
}

export default function UserLookupForm({
  userValue,
  addressValue,
  onUserChange,
  onAddressChange,
  onSubmit,
  loading,
  error,
}: Props) {
  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (!loading) onSubmit()
  }

  return (
    <div className="silo-panel silo-top-card p-6 mb-6">
      <div className="space-y-4">
        <div>
          <label htmlFor="user-address-input" className="block text-sm font-medium silo-text-main mb-2">
            User address
          </label>
          <input
            id="user-address-input"
            value={userValue}
            onChange={(e) => onUserChange(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="0x… user wallet address"
            className="w-full silo-input silo-input--md font-mono focus:outline-none focus:ring-0"
          />
        </div>

        <div>
          <label htmlFor="user-silo-input" className="block text-sm font-medium silo-text-main mb-2">
            Silo or SiloConfig address, or a block explorer URL
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="user-silo-input"
              value={addressValue}
              onChange={(e) => onAddressChange(e.target.value)}
              onKeyDown={submitOnEnter}
              placeholder="0x… or supported explorer link to Silo / SiloConfig"
              className="flex-1 min-w-0 silo-input silo-input--md font-mono focus:outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading}
              className="silo-btn-primary shrink-0 self-stretch sm:self-auto"
            >
              {loading ? 'Loading…' : 'Look up'}
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm silo-alert silo-alert-error">{error}</p> : null}
    </div>
  )
}
