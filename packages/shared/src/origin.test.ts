import { describe, expect, it } from "vitest"
import { originOf, originText, terminalName, wokenWords } from "./origin.ts"

const MIN = 60_000
const now = 1_800_000_000_000
const session = (entrypoint: string | null, more: { terminal?: string | null; lastRun?: { startedAt: number; endedAt: number | null } | null } = {}) => ({
  entrypoint,
  ...more,
})

describe("originOf: where a session runs, from CLAUDE_CODE_ENTRYPOINT", () => {
  it.each([
    ["cli", "terminal", "Terminal"],
    ["claude-desktop", "desktop", "Claude desktop"],
    ["claude-vscode", "ide", "IDE · VS Code"],
    ["claude-jetbrains", "ide", "IDE · JetBrains"],
    ["sdk-ts", "sdk", "Agent SDK app"],
    ["sdk-py", "sdk", "Agent SDK app"],
    ["sdk-cli", "headless", "Headless (claude -p)"],
  ])("%s is %s: %s", (entrypoint, kind, label) => {
    expect(originOf(session(entrypoint))).toEqual({ kind, label })
  })

  it("shows an entrypoint it doesn't know as it is, rather than guessing", () => {
    expect(originOf(session("t3code"))).toEqual({ kind: "other", label: "t3code" })
  })

  it("names the terminal app after Terminal when TERM_PROGRAM said which", () => {
    expect(originOf(session("cli", { terminal: "WezTerm" }))).toEqual({ kind: "terminal", label: "Terminal · WezTerm" })
    expect(originOf(session("cli", { terminal: "iTerm.app" }))?.label).toBe("Terminal · iTerm")
    expect(originOf(session("cli", { terminal: "vscode" }))?.label).toBe("Terminal · VS Code")
  })

  it("is a terminal for a session with no entrypoint but a terminal app, and unknown (null) with neither", () => {
    expect(originOf(session(null, { terminal: "ghostty" }))).toEqual({ kind: "terminal", label: "Terminal · Ghostty" })
    expect(originOf(session(null))).toBeNull()
    expect(originOf(session("  "))).toBeNull()
  })

  it("is Woken by Cello while a woken run of it is going, whatever started it", () => {
    expect(originOf(session("claude-desktop", { lastRun: { startedAt: now - MIN, endedAt: null } }))).toEqual({ kind: "woken", label: "Woken by Cello" })
    expect(originOf(session(null, { lastRun: { startedAt: now - MIN, endedAt: null } }))).toEqual({ kind: "woken", label: "Woken by Cello" })
  })

  it("goes back to where it runs once the woken run ended", () => {
    expect(originOf(session("cli", { lastRun: { startedAt: now - 9 * MIN, endedAt: now - 5 * MIN } }))).toEqual({ kind: "terminal", label: "Terminal" })
  })
})

describe("wokenWords and originText", () => {
  it("say Woken by Cello during a run, then when it was last woken", () => {
    expect(wokenWords(session("cli", { lastRun: { startedAt: now - MIN, endedAt: null } }), now)).toBe("Woken by Cello")
    expect(wokenWords(session("cli", { lastRun: { startedAt: now - 9 * MIN, endedAt: now - 5 * MIN } }), now)).toBe("last woken by Cello 5m ago")
    expect(wokenWords(session("cli"), now)).toBeNull()
  })

  it("put the two together, in one line for the CLI and the details", () => {
    expect(originText(session("cli", { terminal: "WezTerm" }), now)).toBe("Terminal · WezTerm")
    expect(originText(session("claude-desktop", { lastRun: { startedAt: now - 9 * MIN, endedAt: now - 5 * MIN } }), now)).toBe(
      "Claude desktop · last woken by Cello 5m ago",
    )
    expect(originText(session("cli", { lastRun: { startedAt: now - MIN, endedAt: null } }), now)).toBe("Woken by Cello")
    expect(originText(session(null), now)).toBeNull()
  })
})

describe("terminalName", () => {
  it.each([
    ["WezTerm", "WezTerm"],
    ["iTerm.app", "iTerm"],
    ["Apple_Terminal", "macOS Terminal"],
    ["vscode", "VS Code"],
    ["ghostty", "Ghostty"],
    ["WarpTerminal", "Warp"],
    ["tmux", "tmux"],
    ["Alacritty", "Alacritty"],
  ])("%s reads %s", (value, name) => {
    expect(terminalName(value)).toBe(name)
  })
})
