/** Public GitHub repo that hosts Positions snapshot workflows. */
export const GITHUB_ACTIONS_REPO = 'silo-finance/actions'

export const BLACKLIST_SILOS_WORKFLOW_PATH = 'blacklist-silos.yml'

export function getBlacklistSilosWorkflowUrl(): string {
  return `https://github.com/${GITHUB_ACTIONS_REPO}/actions/workflows/${BLACKLIST_SILOS_WORKFLOW_PATH}`
}

export type BlacklistClipboardMarket = {
  chainKey: string
  siloAddress: string
}

export function buildBlacklistClipboardPayload(markets: BlacklistClipboardMarket[]): string {
  return `${JSON.stringify({ markets }, null, 2)}\n`
}
