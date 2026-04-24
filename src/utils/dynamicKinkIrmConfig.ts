/**
 * `IDynamicKinkModel.Config` (match [`DynamicKinkModel.json`](../abis/DynamicKinkModel.json) `updateConfig`).
 * All int256 / int96 fields are represented as `bigint` for exact encoding.
 */
export type DynamicKinkIrmConfig = {
  ulow: bigint
  u1: bigint
  u2: bigint
  ucrit: bigint
  rmin: bigint
  kmin: bigint
  kmax: bigint
  alpha: bigint
  cminus: bigint
  cplus: bigint
  c1: bigint
  c2: bigint
  dmax: bigint
}

const CONFIG_KEYS: (keyof DynamicKinkIrmConfig)[] = [
  'ulow',
  'u1',
  'u2',
  'ucrit',
  'rmin',
  'kmin',
  'kmax',
  'alpha',
  'cminus',
  'cplus',
  'c1',
  'c2',
  'dmax',
]

/**
 * `JSON.parse` mangles integers above `Number.MAX_SAFE_INTEGER`. The upstream preset file uses
 * full-width `int256` values — quote numeric tokens for known config keys, then `BigInt` them.
 */
export function preprocessDkinkJsonConfigNumbers(rawJson: string): string {
  let s = rawJson
  for (const k of CONFIG_KEYS) {
    s = s.replace(new RegExp(`"${k}":\\s*([0-9]+)(?=[,\\s}])`, 'g'), `"${k}":"$1"`)
  }
  return s
}

function coerceBigintField(v: unknown, key: string): bigint {
  if (typeof v === 'bigint') {
    return v
  }
  if (typeof v === 'string' && /^-?[0-9]+$/.test(v)) {
    return BigInt(v)
  }
  if (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) {
    return BigInt(v)
  }
  throw new Error(`Invalid IRM config field ${key}.`)
}

export function parseDynamicKinkIrmConfigFromJsonObj(
  obj: Record<string, unknown>
): DynamicKinkIrmConfig {
  const out: Partial<DynamicKinkIrmConfig> = {}
  for (const k of CONFIG_KEYS) {
    out[k] = coerceBigintField(obj[k], k)
  }
  return out as DynamicKinkIrmConfig
}

/** Ethers `Result` for `IDynamicKinkModel.Config` (tuple or key-value object). */
export function parseDynamicKinkIrmConfigFromEthers(
  value: unknown
): DynamicKinkIrmConfig | null {
  if (value == null) return null
  if (Array.isArray(value) && value.length === 13) {
    return parseDynamicKinkIrmConfigFromJsonObj(
      Object.fromEntries(CONFIG_KEYS.map((k, i) => [k, value[i]]))
    )
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    try {
      return parseDynamicKinkIrmConfigFromJsonObj(value as Record<string, unknown>)
    } catch {
      return null
    }
  }
  return null
}

/** Tuple order for `updateConfig` / `verifyConfig` ABI calls. */
export function dynamicKinkIrmConfigToTuple(
  c: DynamicKinkIrmConfig
): [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
] {
  return [
    c.ulow,
    c.u1,
    c.u2,
    c.ucrit,
    c.rmin,
    c.kmin,
    c.kmax,
    c.alpha,
    c.cminus,
    c.cplus,
    c.c1,
    c.c2,
    c.dmax,
  ]
}

export function sameDynamicKinkIrmConfig(a: DynamicKinkIrmConfig, b: DynamicKinkIrmConfig): boolean {
  return CONFIG_KEYS.every((k) => a[k] === b[k])
}
