export default function Footer() {
  return (
    <footer className="px-4 pb-6 pt-2 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="silo-panel-soft rounded-2xl px-6 py-3 flex items-center justify-center text-xs">
          <span className="silo-text-faint">©{new Date().getFullYear()} Silo Finance</span>
        </div>
      </div>
    </footer>
  )
}
