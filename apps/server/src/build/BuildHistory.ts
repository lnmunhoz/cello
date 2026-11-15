// Build history (CEL-50): every build a server has run in this data folder, newest first. A server
// records its build once, when it starts (`recordOnStart`); starting the same build again moves only
// its last start. A new build keeps the commits merged since the previous recorded build: git's answer
// when the server can ask a checkout, else the list its web build carries (build.json), which is since
// whatever was built in the same folder before.
import type { BuildPage, BuildRecord, ServerBuild } from "@cello/contract/build"
import { Invalid } from "@cello/contract/errors"
import { Caller } from "@cello/contract/rpcs"
import { buildKey } from "@cello/shared/build"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as Seed from "../persistence/Seed.ts"
import { BuildInfo } from "./BuildInfo.ts"

export class BuildHistory extends Context.Service<BuildHistory, {
  /**
   * Records `build` as running: a new row the first time (and a `build.recorded` event per workspace),
   * else its last start moves. Null, and nothing recorded, for a server that serves no web app.
   */
  readonly record: (build: ServerBuild) => Effect.Effect<BuildRecord | null, never, Caller>
  /** A page of builds, newest first; `before` is the previous page's `next`. */
  readonly list: (page: { readonly before?: number | undefined; readonly limit?: number | undefined }) => Effect.Effect<BuildPage, Invalid>
}>()("cello/BuildHistory") {}

export interface BuildHistoryOptions {
  /** First-parent commit subjects in `from..to`, newest first; null when that can't be told. Left out: never asks. */
  readonly changesBetween?: ((from: string, to: string) => ReadonlyArray<string> | null) | undefined
}

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

/**
 * What changed in a new build since `previous`, the newest recorded one: nothing at the same commit;
 * git's list when it can tell; otherwise (no previous build, no commits, or git doesn't know them) the
 * web build's own list.
 */
export const changesSince = (input: {
  readonly previous: { readonly commit: string | null } | null
  readonly commit: string | null
  readonly webChanges: ReadonlyArray<string>
  readonly changesBetween: BuildHistoryOptions["changesBetween"]
}): ReadonlyArray<string> => {
  const { previous, commit } = input
  if (previous === null || previous.commit === null || commit === null) return input.webChanges
  if (previous.commit === commit) return []
  return input.changesBetween?.(previous.commit, commit) ?? input.webChanges
}

interface BuildRow {
  id: string
  number: number
  version: string
  commit_hash: string | null
  web_built_at: number
  started_at: number
  last_started_at: number
  live_until: number | null
  changes: string
}

const fromRow = (row: BuildRow): BuildRecord => ({
  id: row.id,
  number: row.number,
  version: row.version,
  commit: row.commit_hash,
  webBuiltAt: row.web_built_at,
  startedAt: row.started_at,
  lastStartedAt: row.last_started_at,
  liveUntil: row.live_until,
  changes: JSON.parse(row.changes) as ReadonlyArray<string>,
})

const isWhole = (n: number) => Number.isInteger(n)

export const layer = (options: BuildHistoryOptions = {}) =>
  Layer.effect(BuildHistory, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const commands = yield* Commands.Commands
    // The build this server runs, once it's recorded.
    let running: string | null = null

    // When the next build went live: the end of this one's time live.
    const liveUntil = () => sql`(SELECT n.started_at FROM builds n WHERE n.number > b.number ORDER BY n.number LIMIT 1) AS live_until`

    const byId = (id: string) =>
      Effect.map(sql<BuildRow>`SELECT b.*, ${liveUntil()} FROM builds b WHERE b.id = ${id}`, (rows) => (rows[0] ? fromRow(rows[0]) : null))

    const record = Effect.fn("BuildHistory.record")(function* (build: ServerBuild) {
      const web = build.web
      if (web === null) return null
      const commit = build.commit ?? web.commit
      const id = buildKey({ version: build.version, commit, builtAt: web.builtAt })
      // The command id is the build's: its first start inserts it; any later start finds the receipt and
      // writes nothing, and only the last start moves below.
      yield* commands.write({ commandId: `build:${id}`, rpc: "build.record" }, ({ now, emit }) =>
        Effect.gen(function* () {
          const [previous] = yield* sql<{ number: number; commit_hash: string | null }>`
            SELECT number, commit_hash FROM builds ORDER BY number DESC LIMIT 1`
          const changes = changesSince({
            previous: previous ? { commit: previous.commit_hash } : null,
            commit,
            webChanges: web.changes,
            changesBetween: options.changesBetween,
          })
          yield* sql`INSERT INTO builds (id, number, version, commit_hash, web_built_at, started_at, last_started_at, changes, created_at)
            VALUES (${id}, ${(previous?.number ?? 0) + 1}, ${build.version}, ${commit}, ${web.builtAt}, ${build.startedAt},
                    ${build.startedAt}, ${JSON.stringify(changes)}, ${now})`
          const recorded = (yield* byId(id))!
          const workspaces = yield* sql<{ id: string }>`SELECT id FROM workspaces WHERE archived_at IS NULL ORDER BY position`
          for (const workspace of workspaces) {
            yield* emit({ type: "build.recorded", build: recorded }, { workspaceId: workspace.id, projectId: null })
          }
          return id
        }))
      yield* sql`UPDATE builds SET last_started_at = ${build.startedAt} WHERE id = ${id} AND last_started_at < ${build.startedAt}`
      running = id
      return yield* byId(id)
    }, Effect.orDie)

    const list = Effect.fn("BuildHistory.list")(function* (page: { readonly before?: number | undefined; readonly limit?: number | undefined }) {
      const limit = page.limit ?? DEFAULT_LIMIT
      if (!isWhole(limit) || limit < 1 || limit > MAX_LIMIT) {
        return yield* Effect.fail(new Invalid({ field: "limit", reason: `must be a whole number from 1 to ${MAX_LIMIT}` }))
      }
      if (page.before !== undefined && !isWhole(page.before)) {
        return yield* Effect.fail(new Invalid({ field: "before", reason: "must be a build number" }))
      }
      // One more than asked for says whether there's another page.
      const rows = yield* sql<BuildRow>`
        SELECT b.*, ${liveUntil()} FROM builds b WHERE b.number < ${page.before ?? Number.MAX_SAFE_INTEGER}
        ORDER BY b.number DESC LIMIT ${limit + 1}`.pipe(Effect.orDie)
      const builds = rows.slice(0, limit).map(fromRow)
      return { builds, running, next: rows.length > limit ? builds.at(-1)!.number : null } satisfies BuildPage
    })

    return BuildHistory.of({ record, list })
  }))

/** Records the build this server starts on, as the human (the one who deploys). Part of server start. */
export const recordOnStart = Layer.effectDiscard(Effect.gen(function* () {
  const build = yield* (yield* BuildInfo).get()
  const human = yield* Seed.HumanActor
  yield* (yield* BuildHistory).record(build).pipe(Effect.provideService(Caller, { actorId: human.id, sessionId: null }))
}))
