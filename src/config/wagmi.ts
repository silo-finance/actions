import { createConfig, createStorage, http, noopStorage } from 'wagmi'
import { injected, metaMask, safe, walletConnect } from 'wagmi/connectors'
import { appChains } from '@/config/viemChains'

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()

let loggedMissingWcId = false
if (typeof window !== 'undefined' && !wcProjectId && !loggedMissingWcId) {
  loggedMissingWcId = true
  console.warn(
    '[Silo Actions] WalletConnect disabled: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID was empty at build time.',
  )
}

function transports() {
  const out: Record<number, ReturnType<typeof http>> = {}
  for (const chain of appChains) {
    const urls = chain.rpcUrls.default.http
    out[chain.id] = http(urls[0]!)
  }
  return out as Record<(typeof appChains)[number]['id'], ReturnType<typeof http>>
}

function buildConnectors() {
  return [
    /** Safe Apps iframe (when this dApp is loaded inside Safe{Wallet}). Harmless no-op outside. */
    safe({ shimDisconnect: true }),
    /** EIP-6963: works when another extension owns a read-only `window.ethereum` (MetaMask inpage would log a conflict otherwise). */
    metaMask(),
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: 'Silo Control Panel',
              description: 'Execute actions across markets and vaults',
              url:
                typeof window !== 'undefined' && window.location?.origin
                  ? window.location.origin
                  : 'https://localhost',
              icons: [],
            },
          }),
        ]
      : []),
  ]
}

function buildWagmiConfig() {
  return createConfig({
    chains: appChains,
    connectors: buildConnectors(),
    transports: transports(),
    ssr: true,
    storage: createStorage({
      storage:
        typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage,
    }),
  })
}

/**
 * Next.js Fast Refresh + React StrictMode re-import this module and re-mount the provider in dev.
 * Caching the config on `globalThis` avoids recreating the WalletConnect `EthereumProvider` on every
 * HMR cycle (which produced the "WalletConnect Core is already initialized" warning).
 */
type WagmiConfigGlobal = {
  __siloWagmiConfig?: ReturnType<typeof buildWagmiConfig>
}
const wagmiGlobal = globalThis as unknown as WagmiConfigGlobal

export const wagmiConfig: ReturnType<typeof buildWagmiConfig> =
  wagmiGlobal.__siloWagmiConfig ?? (wagmiGlobal.__siloWagmiConfig = buildWagmiConfig())
