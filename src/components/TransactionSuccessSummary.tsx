'use client'

import ShareLinkCopyButton from '@/components/ShareLinkCopyButton'
import type { TxSubmitOutcome } from '@/utils/txSubmitOutcome'

type Props = {
  url: string
  linkLabel: string
  outcome: TxSubmitOutcome
}

export default function TransactionSuccessSummary({ url, linkLabel, outcome }: Props) {
  const summary =
    outcome === 'safe_queue'
      ? 'Signature sent — the proposal is in the queue.'
      : 'On-chain update sent from your wallet.'

  return (
    <div className="rounded-xl border border-[var(--silo-border)] bg-[var(--silo-surface)] px-3 py-3 space-y-2">
      <p className="text-sm silo-text-main m-0 leading-snug">{summary}</p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium silo-text-main hover:underline break-all min-w-0"
        >
          {linkLabel}
        </a>
        <ShareLinkCopyButton url={url} />
      </div>
    </div>
  )
}
