/**
 * How a vault action finished:
 * - `explorer`: EOA wallet broadcast a tx; link points to a block explorer.
 * - `safe_queue`: EOA owner signed a Safe tx off-chain and we pushed it to the Safe Transaction Service.
 * - `safe_wallet_queue`: the connected wallet IS the Safe (Safe{Wallet} over WalletConnect or Safe Apps iframe);
 *   the Safe wallet queued our `eth_sendTransaction` internally — no propose call was made by this dApp.
 */
export type TxSubmitOutcome = 'explorer' | 'safe_queue' | 'safe_wallet_queue'
