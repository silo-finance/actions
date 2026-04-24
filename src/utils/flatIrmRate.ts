import type { DynamicKinkIrmConfig } from '@/utils/dynamicKinkIrmConfig'

const BI0 = BigInt(0)
export const WAD = BigInt('1000000000000000000')
export const WAD_BI = WAD
/** Same convention as typical Silo interest math: 365 * 24 * 60 * 60. */
export const SECONDS_IN_YEAR = BigInt(31536000)

/**
 * `percent` is human 0–100 (e.g. 0.2 means 0.2% per year, 5.07 means 5.07% per year).
 * `1e18` in the kink model is 100% nominal per year; `rmin` is a per-second rate.
 */
export function flatRateToConfig(percent: number): DynamicKinkIrmConfig {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('Rate must be between 0% and 100%.')
  }
  const { rmin } = flatRateCalculationPreview(percent)
  if (rmin < BI0) {
    throw new Error('Invalid rate.')
  }

  return {
    ulow: BI0,
    u1: BI0,
    u2: WAD,
    ucrit: WAD,
    rmin,
    kmin: BI0,
    kmax: BI0,
    alpha: BI0,
    cminus: BI0,
    cplus: BI0,
    c1: BI0,
    c2: BI0,
    dmax: BI0,
  }
}

/**
 * `annualRateWad` = (percent/100) * 1e18. `rmin` = floor(annualRateWad / seconds per year) for
 * the flat curve (per-second min rate in WAD scale).
 */
export function flatRateCalculationPreview(percent: number): { annualRateWad: bigint; rmin: bigint } {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { annualRateWad: BI0, rmin: BI0 }
  }
  const annualRateWad = BigInt(
    Math.round((percent / 100) * Number(WAD))
  )
  const rmin = annualRateWad / SECONDS_IN_YEAR
  return { annualRateWad, rmin }
}

/** Accepts `5,07` (comma) or `5.07` (dot) — human 0–100% input. */
export function parseHumanPercentInput(raw: string): number | null {
  const t = raw.trim().replace(/,/g, '.')
  if (t === '') return null
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return n
}
