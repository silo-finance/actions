import type { EIP1193Provider } from 'viem'

/** Subset of [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) provider info. */
export type Eip6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  /** Reverse DNS identifier; may be empty in older wallets. */
  rdns: string
}

export type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo
  provider: EIP1193Provider
}
