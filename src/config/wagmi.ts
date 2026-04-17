import { createConfig, createStorage, http, noopStorage } from 'wagmi'
import { injected, metaMask, walletConnect } from 'wagmi/connectors'
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

const connectors = [
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

export const wagmiConfig = createConfig({
  chains: appChains,
  connectors,
  transports: transports(),
  ssr: true,
  storage: createStorage({
    storage:
      typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage,
  }),
})
