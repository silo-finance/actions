import { getAddress, Interface } from 'ethers'
import type { WithdrawMarketOnchainState } from '@/utils/withdrawMarketStates'
import type { TargetedCall } from '@/utils/vaultMulticall'

/** Top-up of vault underlying (wei) deposited into the ERC-4626 market for the vault, so `previewRedeem` is non-zero before `reallocate`. */
export const DUST_TOP_UP_WEI = BigInt(10)

export const DUST_HELP_TOOLTIP =
  'This market holds non-transferable dust: the vault still has ERC-4626 shares, but previewRedeem(shares) rounds to zero (withdraw rounding). To complete removal with reallocate, deposit 10 wei of the vault underlying into this market with the vault as receiver (two rounding hops make 10 wei a safe minimum). You can transfer underlying yourself, or include the bundled approve + deposit steps in Bulk Actions below.'

const erc20Iface = new Interface([
  'function approve(address spender,uint256 amount) returns(bool)',
])

const erc4626Iface = new Interface([
  'function deposit(uint256 assets,address receiver) returns(uint256)',
])

export function isWithdrawMarketDustPosition(s: WithdrawMarketOnchainState): boolean {
  return s.supplyShares > BigInt(0) && s.supplyAssets === BigInt(0)
}

export type DustMitigationCopyStep = {
  id: string
  method: string
  argLabel: string
  copyValue: string
}

/**
 * ERC-20 `approve` + ERC-4626 `deposit` for the connected / Safe executor, before vault `reallocate`.
 * `currentAllowance` is `underlying.allowance(executor, market)`.
 */
export function buildDustMitigationBatch(params: {
  underlying: string
  market: string
  vault: string
  topUpAmount: bigint
  currentAllowance: bigint
}): { calls: TargetedCall[]; copySteps: DustMitigationCopyStep[] } {
  const u = getAddress(params.underlying)
  const m = getAddress(params.market)
  const v = getAddress(params.vault)
  const amt = params.topUpAmount
  const cur = params.currentAllowance

  const calls: TargetedCall[] = []
  const copySteps: DustMitigationCopyStep[] = []

  if (cur < amt) {
    if (cur !== BigInt(0)) {
      const data0 = erc20Iface.encodeFunctionData('approve', [m, 0]) as `0x${string}`
      calls.push({ to: u, data: data0 })
      copySteps.push({
        id: 'dust-approve-0',
        method: 'ERC20.approve',
        argLabel: '_spender (address), _amount (uint256)',
        copyValue: `${m}, 0`,
      })
    }
    const dataA = erc20Iface.encodeFunctionData('approve', [m, amt]) as `0x${string}`
    calls.push({ to: u, data: dataA })
    copySteps.push({
      id: 'dust-approve',
      method: 'ERC20.approve',
      argLabel: '_spender (address), _amount (uint256)',
      copyValue: `${m}, ${amt.toString()}`,
    })
  }

  const dataD = erc4626Iface.encodeFunctionData('deposit', [amt, v]) as `0x${string}`
  calls.push({ to: m, data: dataD })
  copySteps.push({
    id: 'dust-deposit',
    method: 'ERC4626.deposit',
    argLabel: '_assets (uint256), _receiver (address)',
    copyValue: `${amt.toString()}, ${v}`,
  })

  return { calls, copySteps }
}
