/**
 * Supported chains and explorer URLs (aligned with silo-market-crafter).
 */

export interface NetworkConfig {
  chainId: number
  displayName: string
  chainName: string
  explorerBaseUrl: string
  nativeTokenSymbol: string
  iconPath: string
  /** Public HTTPS RPC(s) for `wallet_addEthereumChain` when the wallet does not know this chain yet. */
  walletRpcUrls: string[]
}

export const NETWORK_CONFIGS: NetworkConfig[] = [
  {
    chainId: 1,
    displayName: 'Ethereum Mainnet',
    chainName: 'mainnet',
    explorerBaseUrl: 'https://etherscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/ethereum.svg',
    walletRpcUrls: ['https://ethereum.publicnode.com'],
  },
  {
    chainId: 10,
    displayName: 'Optimism',
    chainName: 'optimism',
    explorerBaseUrl: 'https://optimistic.etherscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/optimism.svg',
    walletRpcUrls: ['https://mainnet.optimism.io'],
  },
  {
    chainId: 50,
    displayName: 'XDC Network',
    chainName: 'xdc',
    explorerBaseUrl: 'https://xdcscan.com',
    nativeTokenSymbol: 'XDC',
    iconPath: '/network-icons/xdc.svg',
    walletRpcUrls: ['https://rpc.xdcrpc.com'],
  },
  {
    chainId: 56,
    displayName: 'BNB Chain',
    chainName: 'bnb',
    explorerBaseUrl: 'https://bscscan.com',
    nativeTokenSymbol: 'BNB',
    iconPath: '/network-icons/bnb.svg',
    walletRpcUrls: ['https://bsc-dataseed1.binance.org'],
  },
  {
    chainId: 42161,
    displayName: 'Arbitrum One',
    chainName: 'arbitrum_one',
    explorerBaseUrl: 'https://arbiscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/arbitrum.svg',
    walletRpcUrls: ['https://arb1.arbitrum.io/rpc'],
  },
  {
    chainId: 43114,
    displayName: 'Avalanche C-Chain',
    chainName: 'avalanche',
    explorerBaseUrl: 'https://snowtrace.io',
    nativeTokenSymbol: 'AVAX',
    iconPath: '/network-icons/avalanche.svg',
    walletRpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
  },
  {
    chainId: 146,
    displayName: 'Sonic',
    chainName: 'sonic',
    explorerBaseUrl: 'https://sonicscan.org',
    nativeTokenSymbol: 'S',
    iconPath: '/network-icons/sonic.webp',
    walletRpcUrls: ['https://rpc.soniclabs.com'],
  },
  {
    chainId: 196,
    displayName: 'OKX',
    chainName: 'okx',
    explorerBaseUrl: 'https://www.okx.com/web3/explorer/xlayer',
    nativeTokenSymbol: 'OKB',
    iconPath: '/network-icons/okx.png',
    walletRpcUrls: ['https://rpc.xlayer.tech'],
  },
  {
    chainId: 1776,
    displayName: 'Injective',
    chainName: 'injective',
    explorerBaseUrl: 'https://blockscout.injective.network',
    nativeTokenSymbol: 'INJ',
    iconPath: '/network-icons/injective.svg',
    walletRpcUrls: ['https://sentry.evm-rpc.injective.network'],
  },
  {
    chainId: 4326,
    displayName: 'MegaETH',
    chainName: 'megaeth',
    explorerBaseUrl: 'https://mega.etherscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/megaeth.ico',
    walletRpcUrls: ['https://mainnet.megaeth.com/rpc'],
  },
  {
    chainId: 5000,
    displayName: 'Mantle',
    chainName: 'mantle',
    explorerBaseUrl: 'https://mantlescan.xyz',
    nativeTokenSymbol: 'MNT',
    iconPath: '/network-icons/mantle.ico',
    walletRpcUrls: ['https://rpc.mantle.xyz'],
  },
]

const NETWORK_CONFIG_MAP: Map<number, NetworkConfig> = new Map(
  NETWORK_CONFIGS.map((config) => [config.chainId, config])
)

export function getNetworkConfig(chainId: number | string): NetworkConfig | undefined {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId
  return NETWORK_CONFIG_MAP.get(id)
}

export function getNetworkDisplayName(chainId: number | string): string {
  const config = getNetworkConfig(chainId)
  if (config) return config.displayName
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId
  return `Network ${id}`
}

export function getNetworkIconPath(chainId: number | string): string | null {
  const config = getNetworkConfig(chainId)
  return config?.iconPath ?? null
}

export function getExplorerBaseUrl(chainId: number | string): string {
  const config = getNetworkConfig(chainId)
  if (config) return config.explorerBaseUrl
  return 'https://etherscan.io'
}

export function getExplorerAddressUrl(chainId: number | string, address: string): string {
  const baseUrl = getExplorerBaseUrl(chainId)
  return `${baseUrl}/address/${address}`
}

/** Block explorer URL for an on-chain transaction hash (supported networks only). */
export function getExplorerTxUrl(chainId: number | string, txHash: string): string | null {
  const config = getNetworkConfig(chainId)
  if (!config) return null
  const h = typeof txHash === 'string' && txHash.startsWith('0x') ? txHash : `0x${txHash}`
  return `${config.explorerBaseUrl}/tx/${h}`
}

export function isChainSupported(chainId: number | string): boolean {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId
  return NETWORK_CONFIG_MAP.has(id)
}

/** EIP-3082 / `wallet_addEthereumChain` param shape (snake_case keys per spec). */
export type WalletAddEthereumChainParameter = {
  chainId: string
  chainName: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  rpcUrls: string[]
  blockExplorerUrls: string[]
}

/**
 * Build `wallet_addEthereumChain` params for a supported chain (when `wallet_switchEthereumChain` fails because the chain is unknown to the wallet).
 */
export function getWalletAddEthereumChainParameter(chainId: number): WalletAddEthereumChainParameter | null {
  const c = getNetworkConfig(chainId)
  if (!c?.walletRpcUrls?.length) return null
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: c.displayName,
    nativeCurrency: {
      name: c.nativeTokenSymbol,
      symbol: c.nativeTokenSymbol,
      decimals: 18,
    },
    rpcUrls: [...c.walletRpcUrls],
    blockExplorerUrls: [c.explorerBaseUrl.replace(/\/$/, '')],
  }
}
