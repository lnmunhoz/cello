// The Agents page is a design prototype for now (CEL-65): the sidebar's "Agents working" opens it only
// on a device that has visited `/agents?agents=a|b|c`, which remembers the layout picked. Removed once
// Lucas picks a layout.
import type { AgentsLayout } from "./layout.ts"

const KEY = "cello:agents-page"

/** The layout this device last opened the Agents page with, or null: the prototype is off here. */
export const agentsPrototype = (): AgentsLayout | null => {
  try {
    const value = localStorage.getItem(KEY)
    return value === "a" || value === "b" || value === "c" ? value : null
  } catch {
    return null
  }
}

export const rememberAgentsPrototype = (layout: AgentsLayout) => {
  try {
    localStorage.setItem(KEY, layout)
  } catch {
    // No storage (a private window): the sidebar link stays off, the page still works by its URL.
  }
}
