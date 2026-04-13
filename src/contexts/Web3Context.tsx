'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { BrowserProvider } from 'ethers'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on?: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

type Web3ContextValue = {
  account: string
  chainId: number | null
  provider: BrowserProvider | null
  isConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
  switchNetwork: (targetChainId: number) => Promise<void>
  refreshChainId: () => Promise<void>
}

const Web3Context = createContext<Web3ContextValue | undefined>(undefined)

export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState('')
  const [chainId, setChainId] = useState<number | null>(null)
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider | null>(null)

  const refreshChainId = useCallback(async () => {
    if (!window.ethereum) return
    try {
      const hex = (await window.ethereum.request({ method: 'eth_chainId' })) as string
      setChainId(parseInt(hex, 16))
    } catch {
      setChainId(null)
    }
  }, [])

  /** Ethers v6 caches network on BrowserProvider; after wallet chain switch it must be recreated or RPC throws `network changed`. */
  const recreateBrowserProvider = useCallback(() => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setBrowserProvider(null)
      return
    }
    setBrowserProvider(new BrowserProvider(window.ethereum))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return
    const eth = window.ethereum

    recreateBrowserProvider()

    /** Restore session without a popup — MetaMask already granted this origin. */
    void (async () => {
      try {
        const accounts = (await eth.request({ method: 'eth_accounts' })) as string[]
        if (accounts.length > 0) {
          setAccount(accounts[0])
          await refreshChainId()
        }
      } catch {
        // ignore
      }
    })()

    const onChainChanged = () => {
      void refreshChainId()
      recreateBrowserProvider()
    }

    const onAccountsChanged = (accs: unknown) => {
      const accounts = accs as string[]
      if (!Array.isArray(accounts) || accounts.length === 0) {
        setAccount('')
        setChainId(null)
        return
      }
      setAccount(accounts[0])
      void refreshChainId()
      recreateBrowserProvider()
    }

    eth.on?.('chainChanged', onChainChanged)
    eth.on?.('accountsChanged', onAccountsChanged)
    return () => {
      eth.removeListener?.('chainChanged', onChainChanged)
      eth.removeListener?.('accountsChanged', onAccountsChanged)
    }
  }, [recreateBrowserProvider, refreshChainId])

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert('MetaMask is not installed. Please install MetaMask to continue.')
      return
    }
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
      if (accounts.length > 0) {
        setAccount(accounts[0])
        await refreshChainId()
      }
    } catch (e) {
      console.error('connect', e)
    }
  }, [refreshChainId])

  const disconnect = useCallback(() => {
    setAccount('')
    setChainId(null)
  }, [])

  const switchNetwork = useCallback(
    async (targetChainId: number) => {
      if (!window.ethereum) return
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${targetChainId.toString(16)}` }],
        })
        await refreshChainId()
        recreateBrowserProvider()
      } catch (error) {
        const walletError = error as { code?: number; message?: string }
        if (walletError.code === 4001) return
        if (walletError.code === -32002) {
          alert('Network switch request is already pending in wallet.')
          return
        }
        alert(`Failed to switch network.${walletError.message ? ` ${walletError.message}` : ''}`)
      }
    },
    [refreshChainId, recreateBrowserProvider]
  )

  const value = useMemo<Web3ContextValue>(
    () => ({
      account,
      chainId,
      provider: account && browserProvider ? browserProvider : null,
      isConnected: Boolean(account),
      connect,
      disconnect,
      switchNetwork,
      refreshChainId,
    }),
    [account, chainId, browserProvider, connect, disconnect, switchNetwork, refreshChainId]
  )

  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>
}

export function useWeb3() {
  const ctx = useContext(Web3Context)
  if (!ctx) throw new Error('useWeb3 must be used within Web3Provider')
  return ctx
}
