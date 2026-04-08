import Link from 'next/link'

export default function SiloPlaceholderPage() {
  return (
    <div className="silo-page px-4 py-10 sm:px-6 flex items-center justify-center">
      <div className="max-w-lg w-full silo-panel silo-top-card p-10 text-center">
        <Link href="/" className="text-sm font-semibold silo-text-soft hover:silo-text-main inline-block mb-6">
          ← Home
        </Link>
        <h1 className="text-3xl font-bold silo-text-main mb-3">Silo</h1>
        <p className="silo-text-soft">This section is coming soon.</p>
      </div>
    </div>
  )
}
