// What waking sessions (CEL-92) needs from outside: where run logs go, the environment woken runs get,
// and the waits. server.ts makes it from its options (the data folder, its port once bound); tests
// shorten the waits or use the test clock, and replace the process check.
import { WAKE_BATCH_MS } from "@cello/contract/wake"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { isAlive } from "../process/isAlive.ts"

/** Cello waits this long after Lucas's last action before waking, so quick comments make one wake. */
export const BATCH = Duration.millis(WAKE_BATCH_MS)

/** A session that checked in this recently isn't woken: its process may only now be going away. */
export const QUIET = Duration.minutes(2)

/** The folder under the data folder that holds run logs (`runs/<session>/<time>.jsonl`), left out of backups. */
export const RUNS_DIR = "runs"

/** How many run logs each session keeps. */
export const KEEP_LOGS = 20

export interface WakeOptions {
  /** `<dataDir>/runs`. */
  readonly runsDir: string
  /**
   * The environment a woken run gets: the server's own, plus `CELLO_PORT` so its `cello` commands reach
   * this server. Read again for every run. The API key check in settings reads it too.
   */
  readonly env: Effect.Effect<Readonly<Record<string, string | undefined>>>
  readonly batch?: Duration.Input
  readonly quiet?: Duration.Input
  /** Whether a process on this machine is running (tests replace it). */
  readonly isAlive?: (pid: number) => boolean
}

export class WakeConfig extends Context.Service<WakeConfig, {
  readonly runsDir: string
  readonly env: Effect.Effect<Readonly<Record<string, string | undefined>>>
  readonly batch: Duration.Duration
  readonly quiet: Duration.Duration
  readonly isAlive: (pid: number) => boolean
}>()("cello/WakeConfig") {}

export const make = (options: WakeOptions): WakeConfig["Service"] => ({
  runsDir: options.runsDir,
  env: options.env,
  batch: Duration.fromInputUnsafe(options.batch ?? BATCH),
  quiet: Duration.fromInputUnsafe(options.quiet ?? QUIET),
  isAlive: options.isAlive ?? isAlive,
})

/**
 * Test-only: an e2e server (CELLO_E2E=1) takes shorter waits from CELLO_WAKE_BATCH_MS and
 * CELLO_WAKE_QUIET_MS. Anywhere else they're ignored, so nothing weakens the 2-minute quiet guard on a
 * real board.
 */
export const testWaitsFromEnv = (env: Readonly<Record<string, string | undefined>>): { batch?: number; quiet?: number } => {
  if (env.CELLO_E2E !== "1") return {}
  const millis = (name: string) => {
    const text = env[name]
    const value = Number(text)
    return text !== undefined && text !== "" && Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const batch = millis("CELLO_WAKE_BATCH_MS")
  const quiet = millis("CELLO_WAKE_QUIET_MS")
  return { ...(batch === undefined ? {} : { batch }), ...(quiet === undefined ? {} : { quiet }) }
}

export const layer = (options: WakeOptions) => Layer.succeed(WakeConfig, make(options))
