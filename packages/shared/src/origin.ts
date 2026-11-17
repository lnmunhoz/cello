// Where an agent session runs (CEL-137): a terminal (and which app, when TERM_PROGRAM said), the Claude
// desktop app, an IDE, an app built on the Agent SDK, or a run Cello woke (CEL-92). It reads what the
// CLI reports for the session: Claude Code's CLAUDE_CODE_ENTRYPOINT, TERM_PROGRAM, and the session's
// latest woken run. The Agents page, the task panel, comment receipts and the CLI all say it in these
// words. An entrypoint it doesn't know is shown as it is, never guessed.
import { agoShort } from "./presence.ts"

/** What the origin reads from a session. */
export interface OriginSession {
  /** CLAUDE_CODE_ENTRYPOINT: `cli`, `claude-desktop`, `sdk-ts`… */
  readonly entrypoint: string | null
  /** TERM_PROGRAM where it was started: `WezTerm`, `iTerm.app`, `vscode`… */
  readonly terminal?: string | null | undefined
  /** Its latest woken run (CEL-92): going while `endedAt` is null. */
  readonly lastRun?: { readonly startedAt: number; readonly endedAt: number | null } | null | undefined
}

export type OriginKind = "terminal" | "desktop" | "ide" | "sdk" | "headless" | "woken" | "other"

export interface Origin {
  readonly kind: OriginKind
  /** "Terminal · WezTerm", "Claude desktop", "Woken by Cello". */
  readonly label: string
}

/** TERM_PROGRAM values with a better-known name; anything else reads as it is. */
const TERMINALS: Readonly<Record<string, string>> = {
  "iTerm.app": "iTerm",
  Apple_Terminal: "macOS Terminal",
  vscode: "VS Code",
  ghostty: "Ghostty",
  WarpTerminal: "Warp",
  zed: "Zed",
}

/** "WezTerm", "iTerm", "VS Code": a terminal app from its TERM_PROGRAM. */
export const terminalName = (value: string): string => TERMINALS[value] ?? value

const IDES: ReadonlyArray<readonly [RegExp, string]> = [
  [/vscode/i, "VS Code"],
  [/jetbrains|intellij/i, "JetBrains"],
  [/cursor/i, "Cursor"],
]

const blank = (value: string | null | undefined): value is null | undefined => value == null || value.trim() === ""

/** Where it runs, leaving out a woken run: from its entrypoint, else its terminal app; null when neither says. */
export const hostOf = (session: OriginSession): Origin | null => {
  const terminal = blank(session.terminal) ? null : terminalName(session.terminal.trim())
  const entry = blank(session.entrypoint) ? null : session.entrypoint.trim()
  if (entry === null || entry === "cli") {
    if (entry === null && terminal === null) return null
    return { kind: "terminal", label: terminal ? `Terminal · ${terminal}` : "Terminal" }
  }
  if (entry === "claude-desktop") return { kind: "desktop", label: "Claude desktop" }
  if (entry === "sdk-ts" || entry === "sdk-py") return { kind: "sdk", label: "Agent SDK app" }
  if (entry === "sdk-cli") return { kind: "headless", label: "Headless (claude -p)" }
  const ide = IDES.find(([pattern]) => pattern.test(entry))
  if (ide) return { kind: "ide", label: `IDE · ${ide[1]}` }
  return { kind: "other", label: entry }
}

/** A woken run of it is going right now. */
export const wokenRunning = (session: Pick<OriginSession, "lastRun">): boolean => session.lastRun != null && session.lastRun.endedAt === null

const WOKEN: Origin = { kind: "woken", label: "Woken by Cello" }

/** Where it runs now: Woken by Cello while a woken run goes, else its host; null when unknown. */
export const originOf = (session: OriginSession): Origin | null => (wokenRunning(session) ? WOKEN : hostOf(session))

/** "Woken by Cello" during a woken run, "last woken by Cello 5m ago" after one, else null. */
export const wokenWords = (session: OriginSession, now: number): string | null => {
  const run = session.lastRun
  if (run == null) return null
  return run.endedAt === null ? WOKEN.label : `last woken by Cello ${agoShort(run.endedAt, now)}`
}

/** Both in one line: "Terminal · WezTerm", "Claude desktop · last woken by Cello 5m ago", "Woken by Cello". */
export const originText = (session: OriginSession, now: number): string | null => {
  if (wokenRunning(session)) return WOKEN.label
  const parts = [hostOf(session)?.label, wokenWords(session, now)].filter((p): p is string => p != null)
  return parts.length > 0 ? parts.join(" · ") : null
}
