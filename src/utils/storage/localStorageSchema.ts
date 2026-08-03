export const STORAGE_SCHEMA_KEY = 'silo-actions:storage-schema'
/** Storage-format version (not app semver). Bump to force a one-shot full clear. */
export const STORAGE_SCHEMA_VERSION = '1'

/**
 * If the schema marker is missing or outdated, wipe origin localStorage once
 * and write the current marker. No-op when already on the current schema.
 */
export function ensureLocalStorageSchema(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    if (window.localStorage.getItem(STORAGE_SCHEMA_KEY) === STORAGE_SCHEMA_VERSION) return
    window.localStorage.clear()
    window.localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION)
  } catch {
    // Ignore quota/storage errors; Positions cache still works in memory.
  }
}
