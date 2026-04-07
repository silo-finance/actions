'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTheme } from '@/contexts/ThemeContext'

export default function Header() {
  const { theme, setTheme } = useTheme()
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const unionLogoSrc = `${basePath}/Union.svg`

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="header-shell rounded-[26px] border px-5 py-2.5 shadow-[0_8px_24px_rgba(15,20,31,0.08)] backdrop-blur-md flex justify-between items-center min-h-16">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center">
              <Image src={unionLogoSrc} alt="Union" width={92} height={32} className="header-logo h-8 w-auto" />
            </Link>
            <div className="leading-tight">
              <p className="header-text text-[11px] font-semibold uppercase tracking-[0.14em]">Silo Actions</p>
              <p className="header-text-soft text-[10px]">UI for quick actions</p>
            </div>
          </div>

          <div className="header-theme-toggle flex items-center rounded-full overflow-hidden p-0.5">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className="header-theme-toggle-button px-3 py-1.5 text-xs font-semibold rounded-full"
              aria-pressed={theme === 'light'}
            >
              Light
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className="header-theme-toggle-button px-3 py-1.5 text-xs font-semibold rounded-full"
              aria-pressed={theme === 'dark'}
            >
              Dark
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
