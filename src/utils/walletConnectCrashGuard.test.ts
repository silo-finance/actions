import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installWalletConnectCrashGuard } from '@/utils/walletConnectCrashGuard'

type FakeWindow = {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}

describe('installWalletConnectCrashGuard', () => {
  let fakeWindow: FakeWindow
  let listeners: Array<(e: PromiseRejectionEvent) => void>
  let originalWindow: unknown

  beforeEach(() => {
    listeners = []
    fakeWindow = {
      addEventListener: vi.fn((type: string, cb: (e: PromiseRejectionEvent) => void) => {
        if (type === 'unhandledrejection') listeners.push(cb)
      }),
      removeEventListener: vi.fn((type: string, cb: (e: PromiseRejectionEvent) => void) => {
        listeners = listeners.filter((l) => l !== cb)
      }),
    }
    const g = globalThis as unknown as Record<string, unknown>
    originalWindow = g.window
    g.window = fakeWindow
  })

  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>
    if (originalWindow === undefined) delete g.window
    else g.window = originalWindow
    delete g.__siloWcCrashGuardInstalled
  })

  function makeWcCrashEvent(): PromiseRejectionEvent {
    const err = new TypeError("Cannot read properties of undefined (reading 'request')")
    err.stack =
      'TypeError\n' +
      '    at b.request (index.js:13:2404)\n' +
      '    at b.switchEthereumChain (index.js:13:6004)\n' +
      '    at b.setChainId (index.js:13:6549)\n' +
      '    at Es.onSessionEventRequest (index.js:45:56052)'
    return {
      reason: err,
      preventDefault: vi.fn(),
    } as unknown as PromiseRejectionEvent
  }

  it('swallows the exact WC 2.23.x chainChanged TypeError', () => {
    installWalletConnectCrashGuard()
    const event = makeWcCrashEvent()
    listeners[0]!(event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does NOT swallow unrelated TypeErrors', () => {
    installWalletConnectCrashGuard()
    const err = new TypeError('something unrelated')
    err.stack = 'TypeError\n    at myOwnFunction'
    const event = {
      reason: err,
      preventDefault: vi.fn(),
    } as unknown as PromiseRejectionEvent
    listeners[0]!(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does NOT swallow non-TypeError rejections even if they mention request', () => {
    installWalletConnectCrashGuard()
    const err = new Error("Cannot read properties of undefined (reading 'request')")
    err.stack = 'Error\n    at switchEthereumChain'
    const event = {
      reason: err,
      preventDefault: vi.fn(),
    } as unknown as PromiseRejectionEvent
    listeners[0]!(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('is idempotent: a second install is a no-op', () => {
    installWalletConnectCrashGuard()
    installWalletConnectCrashGuard()
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(1)
  })
})
