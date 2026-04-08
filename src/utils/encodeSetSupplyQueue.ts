import { Interface } from 'ethers'

const SET_SUPPLY_QUEUE = new Interface([
  'function setSupplyQueue(address[] _newSupplyQueue)',
])

/** Calldata for `setSupplyQueue([])` — clears the vault supply queue. */
export function encodeSetSupplyQueueEmpty(): `0x${string}` {
  return SET_SUPPLY_QUEUE.encodeFunctionData('setSupplyQueue', [[]]) as `0x${string}`
}
