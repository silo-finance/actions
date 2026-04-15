'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import packageJson from '../../package.json'
import { useTheme } from '@/contexts/ThemeContext'
import { useWeb3 } from '@/contexts/Web3Context'
import { NETWORK_CONFIGS, getNetworkDisplayName } from '@/utils/networks'
import { normalizeAddress } from '@/utils/addressValidation'
import CopyButton from '@/components/CopyButton'

export default function Header() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { account, chainId, isConnected, connect, disconnect, switchNetwork } = useWeb3()
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''
  const unionLogoSrc = `${basePath}/Union.svg`

  const pathWithoutBase =
    basePath && pathname.startsWith(basePath) ? (pathname.slice(basePath.length) || '/') : pathname
  const norm = (p: string) => p.replace(/\/$/, '') || '/'
  const isNavActive = (segment: string) => norm(pathWithoutBase) === norm(segment)

  const navLinkClass = (active: boolean) =>
    `header-link px-4 py-1.5 text-xs font-semibold rounded-full transition-colors duration-200 hover:bg-[var(--silo-surface-2)] ${
      active ? 'header-link-active bg-[var(--silo-accent-soft)] border border-[var(--header-toggle-border)]' : ''
    }`

  const sortedNetworks = [...NETWORK_CONFIGS].sort((a, b) => a.displayName.localeCompare(b.displayName))

  const formatAddress = (address: string) => {
    const checksummed = normalizeAddress(address) ?? address
    return `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`
  }

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <div className="header-shell rounded-[26px] border px-5 py-2.5 shadow-[0_8px_24px_rgba(15,20,31,0.08)] backdrop-blur-md flex justify-between items-center min-h-16">
          <div className="flex-shrink-0 flex items-center gap-3">
            <Link href="/" className="flex items-center">
              <Image src={unionLogoSrc} alt="Union" width={92} height={32} className="header-logo h-8 w-auto" />
            </Link>
            <div className="flex flex-col leading-tight">
              <span className="header-text text-[11px] font-semibold uppercase tracking-[0.14em]">Control Panel</span>
              <span className="header-text-soft text-[10px]">&nbsp;</span>
              <span className="header-text-soft text-[10px] font-mono tabular-nums" title="UI version">
                v{packageJson.version}
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-2" aria-label="Sections">
            <Link
              href="/vault"
              className={navLinkClass(isNavActive('/vault'))}
              aria-current={isNavActive('/vault') ? 'page' : undefined}
            >
              Vault
            </Link>
            <Link
              href="/silo"
              className={navLinkClass(isNavActive('/silo'))}
              aria-current={isNavActive('/silo') ? 'page' : undefined}
            >
              Silo
            </Link>
          </nav>

          <div className="flex items-center gap-3">
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

            {isConnected ? (
              <div className="flex flex-col items-end gap-1">
                <div className="text-right flex items-center gap-2 justify-end">
                  <div className="header-text text-xs font-mono" title={normalizeAddress(account) ?? account}>
                    {formatAddress(account)}
                  </div>
                  <CopyButton value={normalizeAddress(account) ?? account} iconClassName="w-3.5 h-3.5" className="ml-0" />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={chainId != null ? String(chainId) : ''}
                    onChange={(e) => {
                      const next = Number(e.target.value)
                      if (!Number.isNaN(next)) void switchNetwork(next)
                    }}
                    disabled={chainId == null}
                    className="header-text-soft text-[11px] bg-transparent border border-[var(--header-toggle-border)] rounded-md px-2 py-1 max-w-[200px]"
                    title={chainId != null ? `Network: ${getNetworkDisplayName(chainId)}` : 'Network'}
                  >
                    {chainId != null && !sortedNetworks.some((n) => n.chainId === chainId) && (
                      <option value={String(chainId)}>
                        Current ({chainId})
                      </option>
                    )}
                    {sortedNetworks.map((n) => (
                      <option key={n.chainId} value={String(n.chainId)}>
                        {n.displayName} ({n.chainId})
                      </option>
                    ))}
                  </select>
                  <div className="w-2 h-2 rounded-full bg-[var(--silo-signal-green)] ring-1 ring-[var(--silo-border)]" />
                </div>
                <button
                  type="button"
                  onClick={disconnect}
                  className="header-link text-[10px] font-semibold uppercase tracking-wide transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                className="header-connect-button font-semibold py-2 px-4 rounded-full transition-colors duration-200 text-xs"
              >
                Connect MetaMask
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
