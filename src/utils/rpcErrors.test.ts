import { describe, expect, it } from 'vitest'
import { extractErrorMessage, isUserRejectionError, toUserErrorMessage } from '@/utils/rpcErrors'

describe('extractErrorMessage', () => {
  it('reads pino-style Safe / WalletConnect payloads', () => {
    const err = { time: 1776459285288, level: 50, msg: 'User rejected transaction' }
    expect(extractErrorMessage(err)).toBe('User rejected transaction')
  })

  it('prefers viem shortMessage when present', () => {
    const err = { shortMessage: 'Execution reverted.', message: 'stack trace goes here' }
    expect(extractErrorMessage(err)).toBe('Execution reverted.')
  })

  it('recurses into nested causes / data', () => {
    const err = { data: { error: { message: 'inner boom' } } }
    expect(extractErrorMessage(err)).toBe('inner boom')
  })

  it('returns empty string when nothing readable', () => {
    expect(extractErrorMessage({ foo: 1 })).toBe('')
    expect(extractErrorMessage(null)).toBe('')
  })

  it('unwraps Error instances', () => {
    expect(extractErrorMessage(new Error('oops'))).toBe('oops')
  })
})

describe('isUserRejectionError', () => {
  it('detects EIP-1193 code 4001', () => {
    expect(isUserRejectionError({ code: 4001, message: 'User denied' })).toBe(true)
  })

  it('detects ethers ACTION_REJECTED', () => {
    expect(isUserRejectionError({ code: 'ACTION_REJECTED' })).toBe(true)
  })

  it('detects Safe pino payload with msg="User rejected transaction"', () => {
    expect(
      isUserRejectionError({ time: 1, level: 50, msg: 'User rejected transaction' })
    ).toBe(true)
  })

  it('does not misfire on generic failures', () => {
    expect(isUserRejectionError({ message: 'Execution reverted' })).toBe(false)
  })
})

describe('toUserErrorMessage', () => {
  it('collapses Safe rejection payload to friendly copy', () => {
    const err = { time: 1776459285288, level: 50, msg: 'User rejected transaction' }
    expect(toUserErrorMessage(err)).toBe('Transaction rejected in wallet.')
  })

  it('never returns [object Object]', () => {
    expect(toUserErrorMessage({ foo: 1 })).toBe('Transaction failed.')
    expect(toUserErrorMessage({ foo: 1 }, 'Custom fallback.')).toBe('Custom fallback.')
  })

  it('passes through extracted message', () => {
    expect(toUserErrorMessage({ shortMessage: 'Insufficient gas' })).toBe('Insufficient gas')
  })
})
