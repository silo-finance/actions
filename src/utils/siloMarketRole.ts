/**
 * Typed re-export of the dependency-free SoT in `siloMarketRole.mjs`.
 * App and tests import from this module; do not re-implement LT role rules elsewhere.
 */

export type SiloMarketRole = 'collateral' | 'debt' | 'two-way'

import {
  isCollateralOnlySilo as isCollateralOnlySiloImpl,
  resolveSiloMarketRole as resolveSiloMarketRoleImpl,
} from './siloMarketRole.mjs'

export function resolveSiloMarketRole(
  ltRaw: string | null,
  otherLtRaw: string | null
): SiloMarketRole | null {
  return resolveSiloMarketRoleImpl(ltRaw, otherLtRaw) as SiloMarketRole | null
}

export function isCollateralOnlySilo(ltRaw: string | null, otherLtRaw: string | null): boolean {
  return isCollateralOnlySiloImpl(ltRaw, otherLtRaw)
}
