import {
  parseDynamicKinkIrmConfigFromJsonObj,
  preprocessDkinkJsonConfigNumbers,
  type DynamicKinkIrmConfig,
} from '@/utils/dynamicKinkIrmConfig'

/** Raw upstream file on `silo-contracts-v3` `master` (not vendored; always fresh fetch in the UI). */
export const DKINK_IRM_CONFIGS_URL =
  'https://raw.githubusercontent.com/silo-finance/silo-contracts-v3/master/silo-core/deploy/input/irmConfigs/kink/DKinkIRMConfigs.json'

export type DkinkIrmNamedPreset = {
  name: string
  config: DynamicKinkIrmConfig
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Fetches the Silo kink IRM deployment preset list, parses with bigint-safe number handling.
 */
export async function fetchDkinkIrmPresets(): Promise<DkinkIrmNamedPreset[]> {
  const res = await fetch(DKINK_IRM_CONFIGS_URL, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(`Failed to load IRM configs (${res.status}).`)
  }
  const text = await res.text()
  const safe = preprocessDkinkJsonConfigNumbers(text)
  const parsed: unknown = JSON.parse(safe)
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid IRM config list shape.')
  }
  const out: DkinkIrmNamedPreset[] = []
  for (const item of parsed) {
    if (!isRecord(item)) continue
    const name = item.name
    const cfg = item.config
    if (typeof name !== 'string' || !isRecord(cfg)) {
      throw new Error('Invalid IRM config entry (missing name or config).')
    }
    out.push({ name, config: parseDynamicKinkIrmConfigFromJsonObj(cfg) })
  }
  return out
}
