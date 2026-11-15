import { describe, expect, it } from "vitest"
import { reloadedFor, rememberReload, type TabMemory } from "./reloadGuard.ts"

const memory = (options: { readonly blocked?: boolean; readonly name?: string } = {}) => {
  const items = new Map<string, string>()
  const state = { name: options.name ?? "" }
  const tab: TabMemory = {
    session: () => {
      if (options.blocked) throw new Error("SecurityError: storage is blocked")
      return { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v) }
    },
    name: { get: () => state.name, set: (v) => void (state.name = v) },
  }
  return { tab, state }
}

describe("the build a tab last reloaded for", () => {
  it("is kept in sessionStorage", () => {
    const { tab, state } = memory()
    expect(reloadedFor(tab)).toBeNull()
    rememberReload("0.2.0+bbbbbbb.2000", tab)
    expect(reloadedFor(tab)).toBe("0.2.0+bbbbbbb.2000")
    expect(state.name).toBe("")
  })

  it("falls back to window.name when sessionStorage is blocked, so the loop guard still holds", () => {
    const { tab } = memory({ blocked: true })
    rememberReload("0.2.0+bbbbbbb.2000", tab)
    expect(reloadedFor(tab)).toBe("0.2.0+bbbbbbb.2000")
  })

  it("leaves a window name that isn't its own alone", () => {
    const { tab, state } = memory({ blocked: true, name: "cello-panel" })
    rememberReload("0.2.0+bbbbbbb.2000", tab)
    expect(state.name).toBe("cello-panel")
    expect(reloadedFor(tab)).toBeNull()
  })
})
