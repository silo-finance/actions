'use client'

import { useVaultPermissions } from '@/contexts/VaultPermissionsContext'

type Props = {
  message: string
}

/** Chain or wallet error from a vault action, plus a note when a role preview is active. */
export default function VaultActionFailure({ message }: Props) {
  const { previewRole } = useVaultPermissions()
  if (!message) return null
  return (
    <div className="space-y-2">
      <p className="text-sm silo-alert silo-alert-error m-0">{message}</p>
      {previewRole != null ? (
        <p className="text-sm silo-alert silo-alert-warning m-0">
          This error may be because you are previewing a role. The call still runs as the connected wallet.
        </p>
      ) : null}
    </div>
  )
}
