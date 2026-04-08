import { getAddress, Interface } from 'ethers'

const SET_SUPPLY_QUEUE = new Interface([
  'function setSupplyQueue(address[] _newSupplyQueue)',
])

/** Calldata for `setSupplyQueue(_newSupplyQueue)` with explicit ordering (checksum addresses). */
export function encodeSetSupplyQueue(newSupplyQueue: string[]): `0x${string}` {
  const addrs = newSupplyQueue.map((a) => getAddress(a))
  return SET_SUPPLY_QUEUE.encodeFunctionData('setSupplyQueue', [addrs]) as `0x${string}`
}

/** Calldata for `setSupplyQueue([])` — clears the vault supply queue. */
export function encodeSetSupplyQueueEmpty(): `0x${string}` {
  return encodeSetSupplyQueue([])
}
