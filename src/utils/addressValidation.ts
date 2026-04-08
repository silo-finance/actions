import { ethers } from 'ethers'

export function isHexAddress(value: string): boolean {
  return ethers.isAddress(value)
}

export function normalizeAddress(value: string): string | null {
  try {
    return ethers.getAddress(value.trim())
  } catch {
    return null
  }
}
