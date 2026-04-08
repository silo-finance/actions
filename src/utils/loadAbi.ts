import type { InterfaceAbi } from 'ethers'

export function loadAbi(artifact: unknown): InterfaceAbi {
  if (Array.isArray(artifact)) return artifact as InterfaceAbi
  if (artifact && typeof artifact === 'object' && 'abi' in artifact && Array.isArray((artifact as { abi: unknown }).abi)) {
    return (artifact as { abi: InterfaceAbi }).abi
  }
  return artifact as InterfaceAbi
}
