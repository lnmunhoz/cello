// The `cello` command tree. Each command parses its arguments, makes one RPC call (two when it must
// first turn a task key or a status name into an id), and prints short text, or JSON with --json.
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { describeEvent } from "@cello/client/history"
import type { Actor, AgentSession, Priority, ProjectRef, Status, Task } from "@cello/contract/entities"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import { CliEnv, portOf } from "./env.ts"
import { CliFailure, explain } from "./errors.ts"
import { ago, columns, sessionName } from "./format.ts"
import { GUIDE } from "./guide.ts"
import { IDENTITY_VARIABLES, identityHeaders } from "./identity.ts"
import { repoRootFor } from "./repo.ts"
import { start } from "./start.ts"

export { CliEnv } from "./env.ts"

export const VERSION = "0.2.0"

// ── running a call ──────────────────────────────────────────────────────────────────────────────

/** Runs `use` with a client connected as this environment's caller; any failure becomes a CliFailure. */
const withClient = <A, E>(use: (client: CelloClient["Service"]) => Effect.Effect<A, E | CliFailure, CelloClient>) =>
  Effect.gen(function* () {
    const { env, cwd, now } = yield* CliEnv
    const port = portOf(env)
    const socket = BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)
    return yield* Effect.flatMap(Effect.service(CelloClient), use).pipe(
      Effect.provide(makeClientLayer(socket, identityHeaders(env, cwd))),
      Effect.mapError((error) => error instanceof CliFailure ? error : new CliFailure({ message: explain(error, { port, now: now() }) })),
    )
  })

/** The project a command is about: --project, else the repository the working folder is in. */
const projectRef = (project: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(project)) return { key: project.value } satisfies ProjectRef
    const repoPath = repoRootFor((yield* CliEnv).cwd)
    if (repoPath === null) {
      return yield* new CliFailure({
        message: "This folder isn't in a git repository, so Cello can't tell the project. Pass --project KEY.",
      })
    }
    return { repoPath } satisfies ProjectRef
  })

/** Text from an argument, or markdown from `--body-file` (`-` is stdin). */
const bodyText = (inline: Option.Option<string>, bodyFile: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(bodyFile)) {
      const { readStdin } = yield* CliEnv
      return yield* Effect.promise(() => bodyFile.value === "-" ? readStdin() : Bun.file(bodyFile.value).text())
    }
    return Option.getOrUndefined(inline)
  })

const print = (text: string) => Console.log(text)
const printJson = (value: unknown) => Console.log(JSON.stringify(value, null, 2))

/** One id from a list by name, ignoring case, or a failure listing the real names. */
const byName = <T extends { readonly id: string; readonly name: string }>(kind: string, rows: ReadonlyArray<T>, name: string) => {
  const found = rows.find((row) => row.name.trim().toLowerCase() === name.trim().toLowerCase())
  return found
    ? Effect.succeed(found)
    : Effect.fail(new CliFailure({ message: `No ${kind} named "${name}". ${kind === "status" ? "Statuses" : "Labels"}: ${rows.map((r) => r.name).join(", ") || "none yet"}.` }))
}

const PRIORITIES: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4 }
const PRIORITY_NAMES = ["None", "Urgent", "High", "Medium", "Low"]

// ── formatting ──────────────────────────────────────────────────────────────────────────────────

interface Names {
  readonly statuses: ReadonlyArray<Status>
  readonly sessions: ReadonlyArray<AgentSession>
}

const statusName = (names: Names, id: string) => names.statuses.find((s) => s.id === id)?.name ?? "?"

/** "Claude Code session 2fd0505c", or null when the task has no agent claim. */
const claimOf = (names: Names, task: Task) => {
  const session = names.sessions.find((s) => s.id === task.assigneeSessionId)
  return session ? sessionName(session) : null
}

const taskRows = (names: Names, tasks: ReadonlyArray<Task>) =>
  columns(tasks.map((t) => {
    const claim = claimOf(names, t)
    return [t.key, statusName(names, t.statusId), claim ? `${t.title}  · ${claim}` : t.title]
  }))

const taskLine = (names: Names, task: Task) => `${task.key}  ${statusName(names, task.statusId)}  ${task.title}`

/** Who did something: "Claude Code session 2fd0505c", or the actor's name. */
const author = (
  names: Names & { readonly actors: ReadonlyArray<{ readonly id: string; readonly name: string }> },
  actorId: string,
  sessionId: string | null,
) => {
  const session = names.sessions.find((s) => s.id === sessionId)
  return session ? sessionName(session) : names.actors.find((a) => a.id === actorId)?.name ?? "Someone"
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────

const json = Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print JSON for scripts."))
const project = Flag.String("project").pipe(Flag.optional, Flag.withDescription("Project key, instead of the working folder's."))
const key = Argument.String("key").pipe(Argument.withDescription("A task key, e.g. CEL-3."))

const whoami = Command.make("whoami", { project }, (input) =>
  Effect.gen(function* () {
    const { env, cwd } = yield* CliEnv
    const repoRoot = repoRootFor(cwd)
    const ref: ProjectRef = Option.isSome(input.project) ? { key: input.project.value } : repoRoot ? { repoPath: repoRoot } : {}
    const server = yield* withClient((client) => client["whoami"]({ project: ref })).pipe(
      Effect.catch((failure) => Effect.succeed({ error: failure.message })),
    )
    yield* printJson({
      variables: Object.fromEntries(IDENTITY_VARIABLES.flatMap((name) => (env[name] ? [[name, env[name]]] : []))),
      headers: identityHeaders(env, cwd),
      cwd,
      repoRoot,
      server,
    })
  })).pipe(Command.withDescription("Print, as JSON, who Cello thinks is calling."))

const context = Command.make("context", { project, json }, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    const ctx = yield* withClient((client) => client["context"]({ project: ref }))
    if (input.json) return yield* printJson(ctx)
    const now = (yield* CliEnv).now()
    const visible = ctx.statuses.filter((s) => !s.hidden).map((s) => s.name)
    const hidden = ctx.statuses.filter((s) => s.hidden).map((s) => s.name)
    const lines = [
      `Project   ${ctx.project.key} · ${ctx.project.name}${ctx.project.repoPath ? ` · ${ctx.project.repoPath}` : ""}`,
      `You       ${ctx.session ? `${sessionName(ctx.session)}${ctx.session.entrypoint ? ` (${ctx.session.entrypoint})` : ""}` : `${ctx.actor.name} (human)`}`,
      `Statuses  ${visible.join(" · ")}${hidden.length ? ` (hidden: ${hidden.join(", ")})` : ""}`,
      `Labels    ${ctx.labels.map((l) => l.name).join(" · ") || "none yet"}`,
      "",
      "Claimed by you",
      ...(ctx.claimed.length ? taskRows(ctx, ctx.claimed).map((l) => `  ${l}`) : ["  nothing yet: `cello task list`, then `cello task claim KEY`"]),
    ]
    if (ctx.lostClaims.length) {
      lines.push("", "Claims you lost")
      for (const { event, taskKey } of ctx.lostClaims) {
        const who = author(ctx, event.actorId, event.sessionId)
        const how = event.type === "task.claim_ended" ? `ended when ${who} changed it` : `taken over by ${who}`
        lines.push(`  ${taskKey ?? "?"}  ${how}, ${ago(event.ts, now)}`)
      }
    }
    lines.push("", "Recent activity")
    lines.push(...columns(ctx.recent.map(({ event, taskKey }) => [
      ago(event.ts, now),
      taskKey ?? "",
      describeEvent(event, { ...byIds(ctx), actors: actorsWithSessions(ctx, event) }),
    ])).map((l) => `  ${l}`))
    if (ctx.recent.length === 0) lines.push("  none yet")
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription("Start here: the project, its statuses and labels, your claims and recent activity."))

/** Lookup tables for describeEvent. */
const byIds = (names: { readonly statuses: ReadonlyArray<Status>; readonly labels: ReadonlyArray<{ id: string; name: string }> }) => ({
  statuses: Object.fromEntries(names.statuses.map((s) => [s.id, s])),
  labels: Object.fromEntries(names.labels.map((l) => [l.id, l])) as never,
})

/** describeEvent names the actor; for agents, name the session instead ("Claude Code session 2fd0505c"). */
const actorsWithSessions = (
  names: Names & { readonly actors: ReadonlyArray<Actor> },
  event: { readonly actorId: string; readonly sessionId: string | null },
) => Object.fromEntries(names.actors.map((a) => [a.id, a.id === event.actorId ? { ...a, name: author(names, a.id, event.sessionId) } : a]))

const list = Command.make("list", {
  project,
  json,
  status: Flag.String("status").pipe(Flag.optional, Flag.withDescription("Only this status (by name).")),
  label: Flag.String("label").pipe(Flag.optional, Flag.withDescription("Only tasks with this label.")),
  mine: Flag.Boolean("mine").pipe(Flag.withDefault(false), Flag.withDescription("Only tasks you've claimed.")),
}, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    const result = yield* withClient((client) =>
      client["task.list"]({
        project: ref,
        ...(Option.isSome(input.status) ? { status: input.status.value } : {}),
        ...(Option.isSome(input.label) ? { label: input.label.value } : {}),
        ...(input.mine ? { mine: true } : {}),
      })
    )
    if (input.json) return yield* printJson(result)
    if (result.tasks.length === 0) {
      const which = Option.isSome(input.status) ? `${input.status.value} tasks` : "open tasks"
      return yield* print(`No ${which}${input.mine ? " claimed by you" : ""} in ${result.project.key}.`)
    }
    yield* print(taskRows(result, result.tasks).join("\n"))
  })).pipe(Command.withDescription("Open tasks in the current project."))

const get = Command.make("get", { key, json }, (input) =>
  Effect.gen(function* () {
    const detail = yield* withClient((client) => client["task.get"]({ key: input.key }))
    if (input.json) return yield* printJson(detail)
    const now = (yield* CliEnv).now()
    const { task } = detail
    const labels = task.labelIds.map((id) => detail.labels.find((l) => l.id === id)?.name ?? "?")
    const claim = claimOf(detail, task)
    const lines = [
      `${task.key}  ${task.title}`,
      `Status: ${statusName(detail, task.statusId)} · Priority: ${PRIORITY_NAMES[task.priority]}${labels.length ? ` · Labels: ${labels.join(", ")}` : ""}`,
      ...(claim ? [`Claimed by: ${claim}`] : task.assigneeActorId ? [`Assigned to: ${author(detail, task.assigneeActorId, null)}`] : []),
      `Created by ${author(detail, task.createdByActorId, task.createdBySessionId)}, ${ago(task.createdAt, now)}`,
    ]
    if (task.description.trim()) lines.push("", task.description.trim())
    if (detail.comments.length) {
      lines.push("", `Comments (${detail.comments.length})`)
      for (const c of detail.comments) {
        lines.push(`  ${author(detail, c.actorId, c.sessionId)} · ${ago(c.createdAt, now)}`)
        lines.push(...c.body.split("\n").map((l) => `    ${l}`))
      }
    }
    lines.push("", "History")
    lines.push(...columns(detail.history.map((e) => [ago(e.ts, now), describeEvent(e, { ...byIds(detail), actors: actorsWithSessions(detail, e) })]))
      .map((l) => `  ${l}`))
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription("One task: description, labels, comments, history."))

const create = Command.make("create", {
  title: Argument.String("title"),
  project,
  json,
  description: Flag.String("description").pipe(Flag.optional),
  bodyFile: Flag.String("body-file").pipe(Flag.optional, Flag.withDescription("Read the description from a file; - is stdin.")),
  status: Flag.String("status").pipe(Flag.optional),
  priority: Flag.String("priority").pipe(Flag.optional, Flag.withDescription("urgent, high, medium, low or none.")),
  label: Flag.String("label").pipe(Flag.optional, Flag.withDescription("Label names, comma-separated.")),
  parent: Flag.String("parent").pipe(Flag.optional, Flag.withDescription("Parent task key.")),
}, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    const description = yield* bodyText(input.description, input.bodyFile)
    const priority = Option.isSome(input.priority) ? PRIORITIES[input.priority.value.toLowerCase()] : undefined
    if (Option.isSome(input.priority) && priority === undefined) {
      return yield* new CliFailure({ message: `No priority "${input.priority.value}". Use urgent, high, medium, low or none.` })
    }
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const ctx = yield* client["context"]({ project: ref })
        const status = Option.isSome(input.status) ? yield* byName("status", ctx.statuses, input.status.value) : undefined
        const labels = Option.isSome(input.label)
          ? yield* Effect.forEach(input.label.value.split(",").filter((l) => l.trim()), (name) => byName("label", ctx.labels, name))
          : []
        const parent = Option.isSome(input.parent) ? (yield* client["task.get"]({ key: input.parent.value })).task : undefined
        const result = yield* client["task.create"]({
          commandId: newCommandId(),
          projectId: ctx.project.id,
          title: input.title,
          ...(description === undefined ? {} : { description }),
          ...(status ? { statusId: status.id } : {}),
          ...(priority === undefined ? {} : { priority }),
          ...(labels.length ? { labelIds: labels.map((l) => l.id) } : {}),
          ...(parent ? { parentId: parent.id } : {}),
        })
        return { ...result, names: ctx }
      })
    )
    const { names, ...response } = written
    if (input.json) return yield* printJson(response)
    yield* print(`Created ${taskLine(names, response.result)}`)
  })).pipe(Command.withDescription("Create a task in the current project."))

const claim = Command.make("claim", { key, json }, (input) =>
  Effect.gen(function* () {
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const response = yield* client["task.claim"]({ commandId: newCommandId(), key: input.key })
        return { response, names: yield* client["task.get"]({ key: response.result.key }) }
      })
    )
    if (input.json) return yield* printJson(written.response)
    yield* print(`Claimed ${taskLine(written.names, written.response.result)}`)
  })).pipe(Command.withDescription("Assign the task to this session and move it to the first started status."))

const release = Command.make("release", { key, json }, (input) =>
  Effect.gen(function* () {
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const response = yield* client["task.release"]({ commandId: newCommandId(), key: input.key })
        return { response, names: yield* client["task.get"]({ key: response.result.key }) }
      })
    )
    if (input.json) return yield* printJson(written.response)
    yield* print(`Released ${taskLine(written.names, written.response.result)}`)
  })).pipe(Command.withDescription("Give up your claim without finishing the task."))

const move = Command.make("move", { key, status: Argument.String("status"), json }, (input) =>
  Effect.gen(function* () {
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const detail = yield* client["task.get"]({ key: input.key })
        const status = yield* byName("status", detail.statuses, input.status)
        const response = yield* client["task.move"]({
          commandId: newCommandId(),
          id: detail.task.id,
          expectedVersion: detail.task.version,
          statusId: status.id,
        })
        return { response, detail }
      })
    )
    if (input.json) return yield* printJson(written.response)
    const { detail, response } = written
    yield* print(`Moved ${response.result.key}  ${statusName(detail, detail.task.statusId)} → ${statusName(detail, response.result.statusId)}`)
  })).pipe(Command.withDescription("Move a task to a status by name."))

const comment = Command.make("comment", {
  key,
  text: Argument.String("text").pipe(Argument.optional),
  bodyFile: Flag.String("body-file").pipe(Flag.optional, Flag.withDescription("Read the comment from a file; - is stdin.")),
  json,
}, (input) =>
  Effect.gen(function* () {
    const body = yield* bodyText(input.text, input.bodyFile)
    if (body === undefined) {
      return yield* new CliFailure({ message: `Say something: cello task comment ${input.key} "text", or --body-file - for markdown from stdin.` })
    }
    const response = yield* withClient((client) =>
      Effect.gen(function* () {
        const { task } = yield* client["task.get"]({ key: input.key })
        return yield* client["comment.add"]({ commandId: newCommandId(), taskId: task.id, body })
      })
    )
    if (input.json) return yield* printJson(response)
    yield* print(`Commented on ${input.key.toUpperCase()}`)
  })).pipe(Command.withDescription("Add a markdown comment."))

const guide = Command.make("guide", {}, () => print(GUIDE)).pipe(Command.withDescription("How agents work with Cello."))

const task = Command.make("task").pipe(
  Command.withDescription("Tasks: list, get, create, claim, release, move, comment."),
  Command.withSubcommands([list, get, create, claim, release, move, comment]),
)

const startCommand = Command.make("start", {}, () => start).pipe(
  Command.withDescription("Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR)."),
)

export const cello = Command.make("cello").pipe(
  Command.withDescription("A local task board for you and your coding agents."),
  Command.withSubcommands([context, task, whoami, guide, startCommand]),
)

/** Runs `cello` with these arguments (without the program name). */
export const run = (args: ReadonlyArray<string>) => Command.runWith(cello, { version: VERSION })(args)
