'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { BrowserProvider } from 'ethers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useChainId,
  useConnect,
  useConnectors,
  useConnection,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
  WagmiProvider,
} from 'wagmi'
import { wagmiConfig } from '@/config/wagmi'
import type { Eip1193Provider } from '@/utils/clearVaultSupplyQueue'
import { getWalletAddEthereumChainParameter } from '@/utils/networks'
import { extractErrorMessage, isUserRejectionError } from '@/utils/rpcErrors'
import { installWalletConnectCrashGuard } from '@/utils/walletConnectCrashGuard'

function switchFailedBecauseChainNotInWallet(err: unknown): boolean {
  const e = err as { code?: number; message?: string }
  if (e.code === 4902) return true
  const msg = extractErrorMessage(err).toLowerCase()
  return (
    msg.includes('unrecognized chain') ||
    msg.includes('recognize chain') ||
    msg.includes('not been added') ||
    msg.includes('has not been added') ||
    msg.includes('try adding') ||
    msg.includes('wallet_addethereumchain') ||
    msg.includes('no such chain') ||
    (msg.includes('fail to switch') && msg.includes('chain')) ||
    (msg.includes('could not switch') && msg.includes('chain'))
  )
}

export type ConnectMethod = 'injected' | 'walletConnect'

type Web3ContextValue = {
  account: string
  chainId: number | null
  provider: BrowserProvider | null
  /** EIP-1193 provider for Safe SDK and `wallet_*` calls (injected or WalletConnect). */
  eip1193Provider: Eip1193Provider | null
  isConnected: boolean
  connect: (method: ConnectMethod) => Promise<void>
  disconnect: () => void
  switchNetwork: (targetChainId: number) => Promise<void>
  refreshChainId: () => Promise<void>
}

const Web3Context = createContext<Web3ContextValue | undefined>(undefined)

let queryClientSingleton: QueryClient | undefined
function getOrCreateQueryClient() {
  if (typeof window === 'undefined') {
    return new QueryClient({ defaultOptions: { queries: { staleTime: 60000 } } })
  }
  if (!queryClientSingleton) {
    queryClientSingleton = new QueryClient({ defaultOptions: { queries: { staleTime: 60000 } } })
  }
  return queryClientSingleton
}

function Web3StateProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, chainId: accountChainId, connector } = useConnection()
  const defaultChainId = useChainId()
  const { data: walletClient } = useWalletClient()
  const connectMutation = useConnect()
  const connectors = useConnectors()
  const disconnectMutation = useDisconnect()
  const switchChain = useSwitchChain()

  const account = address ?? ''
  const chainId = isConnected ? (accountChainId ?? defaultChainId) : null

  const [browserProvider, setBrowserProvider] = useState<BrowserProvider | null>(null)
  const [eip1193Provider, setEip1193Provider] = useState<Eip1193Provider | null>(null)

  useEffect(() => installWalletConnectCrashGuard(), [])

  const walletChainId = walletClient?.chain?.id

  useEffect(() => {
    if (!isConnected || !address || !walletClient?.chain) {
      setBrowserProvider(null)
      setEip1193Provider(null)
      return
    }
    const acc = walletClient.account
    const accAddr = acc && 'address' in acc ? acc.address : undefined
    if (!accAddr || accAddr.toLowerCase() !== address.toLowerCase()) {
      setBrowserProvider(null)
      setEip1193Provider(null)
      return
    }
    const transport = walletClient.transport as unknown as Eip1193Provider
    const network = {
      chainId: walletClient.chain.id,
      name: walletClient.chain.name,
      ensAddress: walletClient.chain.contracts?.ensRegistry?.address,
    }
    setBrowserProvider(new BrowserProvider(transport, network))
    setEip1193Provider(transport)
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `useWalletClient().data` is often a new object each render; listing walletClient.* caused a setState feedback loop. isConnected, address, and walletChainId bound the session for this sync.
  [isConnected, address, walletChainId])

  const refreshChainId = useCallback(async () => {
    try {
      const p = (await connector?.getProvider?.()) as Eip1193Provider | undefined
      if (!p?.request) return
      await p.request({ method: 'eth_chainId' })
    } catch {
      // ignore
    }
  }, [connector])

  const connect = useCallback(
    async (method: ConnectMethod) => {
      const metaMaskC = connectors.find((c) => c.type === 'metaMask')
      const injectedC = connectors.find((c) => c.type === 'injected')
      const wcC = connectors.find((c) => c.type === 'walletConnect')

      const tryMetaMask = async () => {
        if (!metaMaskC) throw new Error('no_metamask')
        await connectMutation.mutateAsync({ connector: metaMaskC })
      }
      const tryInjected = async () => {
        if (!injectedC) throw new Error('no_injected')
        await connectMutation.mutateAsync({ connector: injectedC })
      }
      const tryWc = async () => {
        if (!wcC) {
          alert(
            'WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in your environment, or use a browser extension wallet.'
          )
          throw new Error('no_walletconnect')
        }
        await connectMutation.mutateAsync({ connector: wcC })
      }

      try {
        if (method === 'injected') {
          if (metaMaskC) {
            try {
              await tryMetaMask()
              return
            } catch {
              /* No MetaMask / user dismissed — fall back to generic injected (Rabby, etc.). */
            }
          }
          await tryInjected()
          return
        }
        await tryWc()
      } catch (e) {
        console.error('connect', e)
      }
    },
    [connectMutation, connectors]
  )

  const disconnect = useCallback(() => {
    void (async () => {
      try {
        await disconnectMutation.mutateAsync()
      } catch {
        // ignore
      }
    })()
  }, [disconnectMutation])

  const switchNetwork = useCallback(
    async (targetChainId: number) => {
      const chainIdHex = `0x${targetChainId.toString(16)}`
      try {
        await switchChain.mutateAsync({ chainId: targetChainId })
        return
      } catch (error) {
        if (isUserRejectionError(error)) return
        const walletError = error as { code?: number }
        if (walletError.code === -32002) {
          alert('Network switch request is already pending in wallet.')
          return
        }
        /* Fall through: try `wallet_switchEthereumChain` / `wallet_addEthereumChain` on the connector EIP-1193 provider. */
      }

      let eth: Eip1193Provider | null = null
      try {
        const p = (await connector?.getProvider?.()) as Eip1193Provider | undefined
        if (p?.request) eth = p
      } catch {
        eth = null
      }
      if (!eth) {
        alert('Could not switch network. Connect a wallet first.')
        return
      }
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
      } catch (swErr) {
        if (isUserRejectionError(swErr)) return
        const we = swErr as { code?: number }
        const shouldTryAdd = we.code === 4902 || switchFailedBecauseChainNotInWallet(swErr)
        if (shouldTryAdd) {
          const addParams = getWalletAddEthereumChainParameter(targetChainId)
          if (addParams) {
            try {
              await eth.request({ method: 'wallet_addEthereumChain', params: [addParams] })
              try {
                await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
              } catch {
                /* Some wallets already activate the chain after add. */
              }
              return
            } catch (addErr) {
              if (isUserRejectionError(addErr)) return
              const addMsg = extractErrorMessage(addErr)
              alert(
                `Could not add this network in your wallet.${addMsg ? ` ${addMsg}` : ''} Add chain ${targetChainId} manually, then try again.`
              )
              return
            }
          }
        }
        const swMsg = extractErrorMessage(swErr)
        alert(`Failed to switch network.${swMsg ? ` ${swMsg}` : ''}`)
      }
    },
    [connector, switchChain]
  )

  const value = useMemo<Web3ContextValue>(
    () => ({
      account,
      chainId,
      provider: account && browserProvider ? browserProvider : null,
      eip1193Provider: account && eip1193Provider ? eip1193Provider : null,
      isConnected: Boolean(isConnected && account),
      connect,
      disconnect,
      switchNetwork,
      refreshChainId,
    }),
    [
      account,
      browserProvider,
      chainId,
      connect,
      disconnect,
      eip1193Provider,
      isConnected,
      refreshChainId,
      switchNetwork,
    ]
  )

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => getOrCreateQueryClient(), [])
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Web3StateProvider>{children}</Web3StateProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export function useWeb3() {
  const ctx = useContext(Web3Context)
  if (!ctx) throw new Error('useWeb3 must be used within Web3Provider')
  return ctx
}
