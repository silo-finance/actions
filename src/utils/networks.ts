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
}

export const NETWORK_CONFIGS: NetworkConfig[] = [
  {
    chainId: 1,
    displayName: 'Ethereum Mainnet',
    chainName: 'mainnet',
    explorerBaseUrl: 'https://etherscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/ethereum.svg',
  },
  {
    chainId: 10,
    displayName: 'Optimism',
    chainName: 'optimism',
    explorerBaseUrl: 'https://optimistic.etherscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/optimism.svg',
  },
  {
    chainId: 50,
    displayName: 'XDC Network',
    chainName: 'xdc',
    explorerBaseUrl: 'https://xdcscan.com',
    nativeTokenSymbol: 'XDC',
    iconPath: '/network-icons/xdc.svg',
  },
  {
    chainId: 56,
    displayName: 'BNB Chain',
    chainName: 'bnb',
    explorerBaseUrl: 'https://bscscan.com',
    nativeTokenSymbol: 'BNB',
    iconPath: '/network-icons/bnb.svg',
  },
  {
    chainId: 42161,
    displayName: 'Arbitrum One',
    chainName: 'arbitrum_one',
    explorerBaseUrl: 'https://arbiscan.io',
    nativeTokenSymbol: 'ETH',
    iconPath: '/network-icons/arbitrum.svg',
  },
  {
    chainId: 43114,
    displayName: 'Avalanche C-Chain',
    chainName: 'avalanche',
    explorerBaseUrl: 'https://snowtrace.io',
    nativeTokenSymbol: 'AVAX',
    iconPath: '/network-icons/avalanche.svg',
  },
  {
    chainId: 146,
    displayName: 'Sonic',
    chainName: 'sonic',
    explorerBaseUrl: 'https://sonicscan.org',
    nativeTokenSymbol: 'S',
    iconPath: '/network-icons/sonic.svg',
  },
  {
    chainId: 196,
    displayName: 'OKX',
    chainName: 'okx',
    explorerBaseUrl: 'https://www.okx.com/web3/explorer/xlayer',
    nativeTokenSymbol: 'OKB',
    iconPath: '/network-icons/okx.svg',
  },
  {
    chainId: 1776,
    displayName: 'Injective',
    chainName: 'injective',
    explorerBaseUrl: 'https://blockscout.injective.network',
    nativeTokenSymbol: 'INJ',
    iconPath: '/network-icons/injective.svg',
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
