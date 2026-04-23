import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="silo-page px-4 py-10 sm:px-6 flex flex-col items-center">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold silo-text-main mb-3">Control Panel</h1>
          <p className="text-xl silo-text-soft">Take direct control of markets and vaults in critical situations</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link
            href="/silo"
            className="silo-panel silo-top-card p-10 text-center transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--silo-accent)]"
          >
            <h2 className="text-2xl font-semibold silo-text-main mb-2">Markets</h2>
            <p className="silo-text-soft text-sm">
              Disable a market or modify interest rates.
              <br />
              Manage markets.
            </p>
          </Link>
          <Link
            href="/vault"
            className="silo-panel silo-top-card p-10 text-center transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--silo-accent)]"
          >
            <h2 className="text-2xl font-semibold silo-text-main mb-2">Vaults</h2>
            <p className="silo-text-soft text-sm">
              Pause deposits entry move markets.
              <br />
              Manage vaults.
            </p>
          </Link>
          <Link
            href="/pause"
            className="silo-panel silo-top-card p-10 text-center transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--silo-accent)]"
          >
            <h2 className="text-2xl font-semibold silo-text-main mb-2">Pause</h2>
            <p className="silo-text-soft text-sm">
              Pause or unpause tracked contracts
              <br />
              via GlobalPause.
            </p>
          </Link>
        </div>
      </div>
    </div>
  )
}
