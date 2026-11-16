// One interface for every agent CLI Cello can run (CEL-92, "Not only Claude"), after T3 Code's
// provider drivers and adapters (packages/provider-core/src/server/ProviderAdapter.ts, driver.ts) at a
// much smaller size. The session host only knows this interface; each CLI is a driver behind it, found
// in the registry by the session's agent kind. Phase ① has one driver, Claude Code (./claudeCode.ts),
// and the unit tests run against a fake one (../../testing/fakeAgent.ts).
//
// - A driver says what it is (`kind`, `name`), what it can do (`capabilities`), whether its CLI is
//   installed, whether a session's conversation is on this machine, and how Cello's permission modes
//   map onto its own.
// - `open` starts working with one of its sessions in a scope: **closing the scope stops it**, killing
//   whatever process the driver started (its whole process group). That's Stop, for every CLI, and
//   nothing outlives a server that shuts down.
// - The open session runs turns: `resume(prompt)` continues the conversation with one prompt. Later
//   phases add `start` (a new session), `send` (a message mid-turn) and `respond` (a permission
//   question answered on the card) here, behind capabilities.
// - A turn reports normalized events, the same for every CLI, and ends once.
import type { CelloMode } from "@cello/contract/entities"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"

/** What a driver's CLI can do; the host offers a feature only when its driver has the capability. */
export interface AgentCapabilities {
  /** Can continue a session by its id (waking needs it). */
  readonly resume: boolean
  /** Can take a message while a turn runs (phase ⑤). */
  readonly streamingInput: boolean
  /** Can pause a turn to ask for a permission (phase ③). */
  readonly permissionRequests: boolean
  /** Which of Cello's permission modes it has. */
  readonly modes: ReadonlyArray<CelloMode>
}

/** A session's permission mode: the CLI's own word for it, and Cello's. */
export interface AgentMode {
  readonly native: string
  readonly cello: CelloMode
}

/** One line the CLI wrote, for the run's log. */
export interface AgentOutput {
  readonly stream: "stdout" | "stderr"
  readonly line: string
}

/** How a turn ended: it finished, it was interrupted (Stop, a shutdown), or it failed (`error` says how). */
export interface TurnEnded {
  readonly outcome: "completed" | "interrupted" | "failed"
  readonly exitCode: number | null
  readonly error: string | null
}

/** What a turn did, the same union whatever the CLI (the card, the log and later the chat read it). */
export type AgentEvent =
  | { readonly type: "run.started"; readonly pid: number | null }
  | { readonly type: "message"; readonly text: string }
  | { readonly type: "tool.started"; readonly name: string }
  | { readonly type: "tool.finished"; readonly name: string }
  | ({ readonly type: "turn.ended" } & TurnEnded)

/** One turn of an open session. */
export interface AgentTurn {
  /** The process running it, when the driver runs one. */
  readonly pid: number | null
  /** Waits for the turn to end; it ends once, and closing the session's scope ends it (interrupted). */
  readonly ended: Effect.Effect<TurnEnded>
}

export interface OpenInput {
  /** The CLI's own id for the session (Claude Code's session id). */
  readonly nativeId: string
  /** The folder it runs in: the session's repo folder. */
  readonly cwd: string
  /** The CLI's own permission mode (AgentDriver.modeFor's `native`). */
  readonly mode: string
  /** The whole environment for its process. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Each line it writes, as it writes it (the host keeps them in the run's log). */
  readonly onOutput: (output: AgentOutput) => void
  /** Each normalized event, as it happens. */
  readonly onEvent: (event: AgentEvent) => void
}

/** A session opened by a driver; closing the scope it was opened in stops it. */
export interface AgentSessionHandle {
  /** Continues the conversation with `prompt`: one turn. */
  readonly resume: (prompt: string) => Effect.Effect<AgentTurn, AgentStartFailed>
}

/** The CLI couldn't be started at all (not found, not executable…). */
export class AgentStartFailed extends Schema.TaggedError<AgentStartFailed>()("AgentStartFailed", {
  message: Schema.String,
}) {}

export interface AgentDriver {
  /** `claude-code`, later `codex`, `grok`…: the value of `agent_sessions.agent_kind`. */
  readonly kind: string
  /** "Claude Code": for settings and the card. */
  readonly name: string
  readonly capabilities: AgentCapabilities
  /** Whether its CLI is installed for the host's environment. */
  readonly installed: (env: Readonly<Record<string, string | undefined>>) => Effect.Effect<boolean>
  /** Whether the session's conversation is on this machine, so it can be continued. */
  readonly hasConversation: (input: { readonly nativeId: string; readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }) => Effect.Effect<boolean>
  /** The mode to run a session with, from the one its hooks recorded (null when none was). */
  readonly modeFor: (recorded: string | null) => AgentMode
  /** Opens one of its sessions in the current scope: closing it stops whatever runs. */
  readonly open: (input: OpenInput) => Effect.Effect<AgentSessionHandle, never, Scope.Scope>
}

/** The drivers Cello knows, by kind. */
export class AgentRegistry extends Context.Service<AgentRegistry, {
  readonly drivers: ReadonlyArray<AgentDriver>
  /** The driver for a session's agent kind; undefined for a kind no driver handles (or none). */
  readonly get: (kind: string | null) => AgentDriver | undefined
}>()("cello/AgentRegistry") {}

/** A registry of these drivers. Adding a CLI is one more driver in the list server.ts passes. */
export const layer = (drivers: ReadonlyArray<AgentDriver>) =>
  Layer.succeed(AgentRegistry, AgentRegistry.of({ drivers, get: (kind) => drivers.find((d) => d.kind === kind) }))
