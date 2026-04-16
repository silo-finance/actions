import { createConfig, http } from 'wagmi'
import { injected, safe, walletConnect } from 'wagmi/connectors'
import { appChains } from '@/config/viemChains'
import { getPendingInjectedTarget } from '@/wallet/pendingInjectedTarget'

const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

function transports() {
  const out: Record<number, ReturnType<typeof http>> = {}
  for (const chain of appChains) {
    const urls = chain.rpcUrls.default.http
    out[chain.id] = http(urls[0]!)
  }
  return out as Record<(typeof appChains)[number]['id'], ReturnType<typeof http>>
}

const connectors = [
  injected({
    shimDisconnect: true,
    target: () => {
      const d = getPendingInjectedTarget()
      if (!d) return undefined
      return {
        id: d.info.uuid,
        name: d.info.name,
        provider: d.provider,
        rdns: d.info.rdns,
        icon: d.info.icon,
      }
    },
  }),
  safe({ shimDisconnect: true }),
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
})
