/**
 * Per-chain RevertingOracle deployments, mirrored from
 * `silo-contracts-v2/silo-oracles/deployments/<chain>/RevertingOracle.sol.json` in the sibling repo.
 *
 * Used by the Silo oracle change action: a silo's ManageableOracle is re-pointed at this address
 * via `proposeOracle(revertingOracle)` so that `beforeQuote` reverts with `ThisOracleAlwaysReverts`
 * and borrow/liquidation paths stop honoring the previous price source.
 *
 * Keep this map in sync with the sibling repo whenever a new chain is added or a RevertingOracle
 * is redeployed (chains not listed here disable the action with a "not deployed" message).
 */
export const REVERTING_ORACLE_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  1: '0xefD889cc63Ddc71306E73FA0d0040160799E6075',
  10: '0xccf804Ee4648EC353Eb665A165D90f86798878F8',
  50: '0xb49329Bf1d95D51681F4E4F644eB37F58E398Abd',
  56: '0xcf8d34CffF69F8d4ab388395E24EF9c46f9a8992',
  146: '0x889Be50f7EF7e0D88C2023c509f4E02D378dbDf0',
  196: '0xE09BD71d81444Af82E1FFAa5F179144F5B64486B',
  1776: '0x1F28BEdE6922351a0c040d3DBC983f3CB937fbAF',
  42161: '0xD5e41d7FA4BD66bD580AD4f68dA36353BA5D3B27',
  43114: '0xf238Bf8Dd41396ea8291208b5969a24557C7bE53',
}

export function getRevertingOracleAddress(chainId: number): `0x${string}` | null {
  return REVERTING_ORACLE_BY_CHAIN_ID[chainId] ?? null
}
