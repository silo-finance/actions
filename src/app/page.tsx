import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="silo-page px-4 py-10 sm:px-6 flex items-center justify-center">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold silo-text-main mb-3">Silo Actions</h1>
          <p className="text-xl silo-text-soft">Choose a tool</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/silo"
            className="silo-panel silo-top-card p-10 text-center transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--silo-accent)]"
          >
            <h2 className="text-2xl font-semibold silo-text-main mb-2">Silo</h2>
            <p className="silo-text-soft text-sm">Silo tools (coming soon)</p>
          </Link>
          <Link
            href="/vault"
            className="silo-panel silo-top-card p-10 text-center transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--silo-accent)]"
          >
            <h2 className="text-2xl font-semibold silo-text-main mb-2">Vault</h2>
            <p className="silo-text-soft text-sm">Inspect vault supply and withdraw queues</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
