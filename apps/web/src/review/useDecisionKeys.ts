import { useEffect, useEffectEvent } from "react"
import { popupTakesEscape } from "../lib/escape.ts"
import { decisionShortcut } from "./decisionKeys.ts"

/**
 * A approves the open packet and S sends it back (CEL-190), on the Review page only. `openKey` is the
 * open packet's task key, or null when no packet is open (a row of questions doesn't count).
 *
 * Approve is the open row's own button, clicked: the same code as the mouse, so its pending state, the
 * "Approved" confirmation, the fold and the failure line all follow, and a disabled button (a decision
 * pending, a screenshot uploading) does nothing. Send back only moves the cursor to the note box:
 * it sends nothing until the button is pressed.
 */
export function useDecisionKeys(openKey: string | null) {
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const { key, metaKey, ctrlKey, altKey, shiftKey, repeat, defaultPrevented } = e
    const target = e.target instanceof HTMLElement ? e.target : null
    const shortcut = decisionShortcut(
      { key, metaKey, ctrlKey, altKey, shiftKey, repeat, defaultPrevented, target },
      { packetOpen: openKey !== null, popupOpen: popupTakesEscape(document) },
    )
    if (shortcut === null || openKey === null) return
    const row = document.querySelector<HTMLElement>(`[data-queue-item="${CSS.escape(openKey)}"][data-open]`)
    if (row === null) return
    e.preventDefault()
    if (shortcut === "approve") row.querySelector<HTMLButtonElement>('button[data-decide="approved"]')?.click()
    else row.querySelector<HTMLTextAreaElement>("textarea")?.focus()
  })
  useEffect(() => {
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}
