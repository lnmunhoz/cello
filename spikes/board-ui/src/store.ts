// The board's data store: the single source of truth. Agent events and user
// drops both write here immediately. Nothing visual lives here.
import { useSyncExternalStore } from "react"

export type Lists = Record<string, string[]>

export const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "doing", label: "In Progress" },
  { id: "done", label: "Done" },
] as const

const verbs = ["Wire", "Fix", "Draft", "Ship", "Spike", "Refactor", "Test", "Document", "Audit", "Polish"]
const nouns = [
  "SQLite store", "event bus", "card drawer", "agent cursor", "column limits", "search index",
  "MCP bridge", "undo stack", "keyboard map", "settings pane", "sync worker", "toast queue",
  "board export", "label picker", "due dates", "markdown preview", "activity feed", "theme tokens",
]
const tags = [
  { tag: "core", tone: "#0ea5e9" },
  { tag: "agent", tone: "#8b5cf6" },
  { tag: "ui", tone: "#f59e0b" },
  { tag: "infra", tone: "#10b981" },
  { tag: "bug", tone: "#ef4444" },
]

export type Card = { id: string; title: string; tag: string; tone: string }

export const CARDS: Record<string, Card> = {}
for (let i = 1; i <= 50; i++) {
  const id = `c${i}`
  const t = tags[(i * 7) % tags.length]
  CARDS[id] = { id, title: `${verbs[(i * 3) % verbs.length]} ${nouns[(i * 5) % nouns.length]}`, ...t }
}

function initialLists(): Lists {
  const ids = Object.keys(CARDS)
  return {
    backlog: ids.slice(0, 16),
    todo: ids.slice(16, 29),
    doing: ids.slice(29, 40),
    done: ids.slice(40, 50),
  }
}

let lists: Lists = initialLists()
const listeners = new Set<() => void>()

export const store = {
  get: () => lists,
  set(next: Lists) {
    lists = next
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  columnOf(card: string) {
    return Object.keys(lists).find((c) => lists[c].includes(card))
  },
  /** Applies a move at once. Returns the source position, or null if the card is unknown. */
  move(card: string, to: string, index: number) {
    const from = store.columnOf(card)
    if (!from || !lists[to]) return null
    const fromIndex = lists[from].indexOf(card)
    const next: Lists = {}
    for (const [c, keys] of Object.entries(lists)) next[c] = keys.filter((k) => k !== card)
    const target = [...next[to]]
    target.splice(Math.max(0, Math.min(target.length, index)), 0, card)
    next[to] = target
    store.set(next)
    return { from, fromIndex }
  },
}

export function useLists() {
  return useSyncExternalStore(store.subscribe, store.get)
}
