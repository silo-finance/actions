import { isHexAddress } from '@/utils/addressValidation'

/**
 * Extracts a hex address from plain input or explorer URL.
 */
export function extractHexAddressLike(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed
  if (isHexAddress(trimmed)) return trimmed

  const txHashMatch = trimmed.match(/0x[a-fA-F0-9]{64}/)
  if (txHashMatch) return txHashMatch[0]
  const addressMatch = trimmed.match(/0x[a-fA-F0-9]{40}/)
  if (addressMatch) return addressMatch[0]

  return trimmed
}
