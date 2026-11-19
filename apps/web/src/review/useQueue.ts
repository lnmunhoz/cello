import { type KeyboardEvent, useEffect, useEffectEvent, useRef, useState } from "react"
import { popupTakesEscape } from "../lib/escape.ts"
import { nextRow } from "../list/rows.ts"
import { nextAfterDecision, rowKey } from "./queue.ts"
import type { QueueRowState } from "./QueueRow.tsx"

/**
 * A queue page's rows, one open at a time (the Review page, the Agents page, CEL-65): `keys` in the
 * order shown, `open` the open one (from the URL), `setOpen` to change it. ↑ ↓ or j k move between
 * rows, Enter opens, Esc closes; the open row comes into view. Spread `list` on the element holding the
 * rows and `row(key)` on each QueueRow.
 */
export function useQueue({ keys, open, setOpen }: {
  readonly keys: ReadonlyArray<string>
  readonly open: string | null
  readonly setOpen: (key: string | null) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  // While the keys move between rows, a parked mouse's hover highlight steps aside, so only the focused
  // row stands out; moving the mouse brings hover back.
  const [usingKeys, setUsingKeys] = useState(false)
  /** Set by openNext: the row it opens takes the focus, so the keys go on working. */
  const focusOpened = useRef(false)
  /** Closes the open row with the latest setOpen: callers pass a new one each render, and the window's key listener shouldn't be re-added for it. */
  const closeOpen = useEffectEvent(() => setOpen(null))
  // The one row Tab lands on; the arrow keys and j/k move it.
  const tabbable = focused !== null && keys.includes(focused) ? focused : (open ?? keys[0] ?? null)

  const headerOf = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-queue-row="${CSS.escape(key)}"]`)
  const focusRow = (key: string) => {
    setFocused(key)
    headerOf(key)?.focus()
  }

  // The row that opens comes into view, whether a click, a key, a decision or a link (?open=) opened it.
  useEffect(() => {
    if (open === null) return
    listRef.current?.querySelector(`[data-queue-item="${CSS.escape(open)}"]`)?.scrollIntoView({ block: "nearest" })
    if (focusOpened.current) {
      focusOpened.current = false
      headerOf(open)?.focus()
    }
  }, [open])

  // With nothing focused (the page just opened, or a decision took the focus away): j/k start from
  // the open row or the first, and Esc closes the open row.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.target !== document.body || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape" && open !== null) {
        if (!popupTakesEscape(document)) closeOpen()
      } else if ((e.key === "j" || e.key === "k") && tabbable !== null) {
        e.preventDefault()
        setUsingKeys(true)
        setFocused(tabbable)
        headerOf(tabbable)?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, tabbable])

  const onRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "Enter") {
      e.preventDefault()
      setUsingKeys(true)
      setOpen(key)
      return
    }
    const next = nextRow(keys, key, rowKey(e.key))
    if (next === null) return
    e.preventDefault()
    setUsingKeys(true)
    focusRow(next)
  }

  // Esc closes the open row from anywhere in the list, and its row takes the focus. Not while typing,
  // nor from a dialog (portaled out of the list), nor while a popup is open over it (a task link's hover
  // card, CEL-142), which Esc closes first.
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (e.key !== "Escape" || open === null || e.defaultPrevented || !e.currentTarget.contains(target)) return
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    if (popupTakesEscape(document)) return
    e.preventDefault()
    setOpen(null)
    focusRow(open)
  }

  return {
    list: {
      ref: listRef,
      "data-keys": usingKeys ? "" : undefined,
      onKeyDown: onListKeyDown,
      onPointerMove: () => {
        if (usingKeys) setUsingKeys(false)
      },
    },
    row: (key: string): QueueRowState => ({
      id: key,
      open: key === open,
      tabbable: key === tabbable,
      hover: !usingKeys,
      onToggle: () => setOpen(key === open ? null : key),
      onFocus: () => setFocused(key),
      onKeyDown: (e) => onRowKeyDown(e, key),
    }),
    /** `key` left the queue (a packet decided, an ask answered): the next row opens, and takes the focus. Returns that row's key, if there is one. */
    openNext: (key: string): string | null => {
      const next = nextAfterDecision(keys, key) ?? null
      focusOpened.current = next !== null
      setOpen(next)
      return next
    },
  }
}
