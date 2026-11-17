import { shouldNotify } from "@cello/shared/updates"
import { useEffect } from "react"
import { toast } from "../components/ui/Toast.tsx"
import { openWhatsNew, updateCommand, useUpdateState } from "./updates.ts"

/**
 * Cello.app's two toasts (CEL-140), each once: "Cello 0.5.1 is available" (Download, What's new) for each
 * new version on the channel, and "Updated to Cello 0.5.1" (What's new) on the first launch of a newer
 * version. However a toast closes, the app is told, so it doesn't come back.
 */
export function UpdateNotices() {
  const state = useUpdateState()
  const available = state ? shouldNotify(state) : null
  const updatedFrom = state?.updatedFrom ?? null
  const current = state?.current ?? null

  useEffect(() => {
    if (!available) return
    toast({
      id: `update-available-${available}`,
      title: `Cello ${available} is available`,
      description: "Download opens the new version's disk image: drag Cello onto Applications.",
      duration: Infinity,
      action: { label: "Download", onAction: () => updateCommand({ kind: "download" }) },
      cancel: { label: "What's new", onCancel: () => openWhatsNew(available) },
      onDismiss: () => updateCommand({ kind: "acknowledge", what: "notify", version: available }),
    })
  }, [available])

  useEffect(() => {
    if (!updatedFrom || !current) return
    toast({
      id: `updated-${current}`,
      title: `Updated to Cello ${current}`,
      description: `From ${updatedFrom}. Your board and its data stayed as they were.`,
      duration: Infinity,
      action: { label: "What's new", onAction: () => openWhatsNew(current) },
      onDismiss: () => updateCommand({ kind: "acknowledge", what: "updated", version: current }),
    })
  }, [updatedFrom, current])

  return null
}
