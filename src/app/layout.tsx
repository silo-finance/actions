import type { Metadata } from 'next'
import { DM_Mono, DM_Sans } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import AnimatedCirclesBackground from '@/components/AnimatedCirclesBackground'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { Web3Provider } from '@/contexts/Web3Context'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  display: 'swap',
  weight: ['400', '500'],
})

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || ''

export const metadata: Metadata = {
  title: 'Control Panel',
  description: 'Execute actions across markets and vaults',
  manifest: `${basePath || ''}/manifest.json`
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var saved = localStorage.getItem('silo-actions-theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var theme = (saved === 'dark' || saved === 'light') ? saved : (prefersDark ? 'dark' : 'light');
                  document.documentElement.classList.remove('theme-light', 'theme-dark');
                  document.documentElement.classList.add(theme === 'dark' ? 'theme-dark' : 'theme-light');
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${dmSans.className} font-sans antialiased`}>
        <AnimatedCirclesBackground />
        <ThemeProvider>
          <Web3Provider>
            <div className="relative z-[1]">
              <Header />
              <main className="pt-5 sm:pt-7">{children}</main>
              <Footer />
            </div>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  )
}
