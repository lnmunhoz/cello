// The `cello` command tree. Each command parses its arguments, makes one RPC call (two when it must
// first turn a task key or a status name into an id), and prints short text, or JSON with --json.
import * as path from "node:path"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { describeEvent } from "@cello/client/history"
import type { Backup } from "@cello/contract/backups"
import type { Actor, AgentSession, DocumentKind, Priority, ProjectRef, Review, Status, Task } from "@cello/contract/entities"
import { BACKUPS_DIR } from "@cello/server/backup/BackupService"
import { BackupFailed, backupOffline, listBackups, reasonOf, restore } from "@cello/server/backup/offline"
import { pagePath } from "@cello/shared/document"
import { formatBytes } from "@cello/shared/bytes"
import { APP_VERSION } from "@cello/shared/version"
import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import { CliEnv, dataDirOf, portOf } from "./env.ts"
import { CliFailure, explain } from "./errors.ts"
import { evidenceFromArgs } from "./evidence.ts"
import { ago, columns, localTime, sessionName } from "./format.ts"
import { GUIDE } from "./guide.ts"
import { type Env, IDENTITY_VARIABLES, identityHeaders } from "./identity.ts"
import { pageFiles } from "./pageFiles.ts"
import { repoRootFor } from "./repo.ts"
import { start } from "./start.ts"

export { CliEnv } from "./env.ts"

export const VERSION = APP_VERSION

/** The raw arguments, for flags whose order matters (`submit`'s --caption after an --attach). */
class CliArgs extends Context.Service<CliArgs, ReadonlyArray<string>>()("cello/CliArgs") {}

// ── running a call ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs `use` with a client connected as this environment's caller; any failure becomes a CliFailure.
 * `whenDown` runs instead when no server answers on CELLO_PORT; without it, that's a failure too.
 */
const withClient = <A, E, B = never>(
  use: (client: CelloClient["Service"]) => Effect.Effect<A, E | CliFailure, CelloClient>,
  whenDown?: Effect.Effect<B, unknown, CliEnv>,
) =>
  Effect.gen(function* () {
    const { env, cwd, now } = yield* CliEnv
    const port = portOf(env)
    const socket = BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)
    return yield* Effect.flatMap(Effect.service(CelloClient), use).pipe(
      Effect.provide(makeClientLayer(socket, identityHeaders(env, cwd))),
      Effect.catch((error): Effect.Effect<A | B, unknown, CliEnv> =>
        whenDown !== undefined && Predicate.isTagged(error, "RpcClientError") ? whenDown : Effect.fail(error)),
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const EVIDENCE_WORDS = { video: "video", image: "screenshot", file: "file", link: "link" } as const

/** "2 steps · 1 video · 1 screenshot · 1 link". */
const packetCounts = (review: Review) =>
  [
    plural(review.steps.length, "step"),
    ...(["video", "image", "file", "link"] as const).flatMap((kind) => {
      const count = review.attachments.filter((a) => a.kind === kind).length
      return count ? [plural(count, EVIDENCE_WORDS[kind])] : []
    }),
  ].join(" · ")

const DECISIONS = { approved: "approved", sent_back: "sent back", superseded: "superseded by a newer one" } as const

/** One review in `task get`: state, who submitted it, summary, steps, evidence and Lucas's note. */
const reviewLines = (
  names: Names & { readonly actors: ReadonlyArray<Actor> },
  review: Review,
  now: number,
): string[] => {
  const state = review.decision === null ? "open" : `${DECISIONS[review.decision]} ${ago(review.decidedAt!, now)}`
  const indent = (text: string) => text.split("\n").map((l) => `    ${l}`)
  return [
    `  Review (${state}), submitted by ${author(names, review.actorId, review.sessionId)}, ${ago(review.createdAt, now)}`,
    ...(review.decisionNote ? indent(`Note: ${review.decisionNote}`) : []),
    ...indent(review.summary.trim()),
    "    How to check:",
    ...review.steps.map((step, i) => `    ${i + 1}. ${step}`),
    ...review.attachments.map((a) => `    ${a.name} (${a.kind})${a.caption ? `: ${a.caption}` : ""}`),
  ]
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
  status: Flag.String("status").pipe(Flag.optional, Flag.withDescription("Only this status, by name (e.g. Backlog, Done). Without it: Todo and In Progress.")),
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
  })).pipe(Command.withDescription("Tasks in the current project: Todo and In Progress unless --status picks another."))

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
    if (detail.documents.length) {
      const { env } = yield* CliEnv
      lines.push("", `Pages (${detail.documents.length})`)
      for (const d of detail.documents) {
        const url = d.projectId === detail.project.id ? `  ${pageUrl(env, detail.project.key, d.slug)}` : ""
        lines.push(`  ${d.title} (${d.kind}, version ${d.version})${url}`)
      }
    }
    if (detail.reviews.length) {
      lines.push("", `Reviews (${detail.reviews.length})`)
      for (const r of [...detail.reviews].reverse()) lines.push(...reviewLines(detail, r, now))
    }
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
  })).pipe(Command.withDescription("One task in full: description, labels, claim, pages, review packets with Lucas's notes, comments, history."))

const create = Command.make("create", {
  title: Argument.String("title").pipe(Argument.withDescription("The task's title, in quotes.")),
  project,
  json,
  description: Flag.String("description").pipe(Flag.optional, Flag.withDescription("The description, in markdown.")),
  bodyFile: Flag.String("body-file").pipe(Flag.optional, Flag.withDescription("Read the description from a file; - is stdin.")),
  status: Flag.String("status").pipe(
    Flag.optional,
    Flag.withDescription("Status by name. Default: the first visible one (Todo). Backlog for ideas that still need discussing."),
  ),
  priority: Flag.String("priority").pipe(Flag.optional, Flag.withDescription("urgent, high, medium, low or none.")),
  label: Flag.String("label").pipe(Flag.atLeast(0), Flag.withDescription("A label name; repeat it, or separate names with commas.")),
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
        const names = input.label.flatMap((value) => value.split(",")).filter((l) => l.trim())
        const labels = yield* Effect.forEach(names, (name) => byName("label", ctx.labels, name))
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
  })).pipe(Command.withDescription("Create a task in the current project (Todo unless --status says otherwise)."))

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
  })).pipe(Command.withDescription("Start working on a task: it's assigned to your session and moves to In Progress. Refused while another live session holds it."))

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
  })).pipe(Command.withDescription("Give up your claim without finishing the task; its status stays."))

const move = Command.make("move", {
  key,
  status: Argument.String("status").pipe(Argument.withDescription("The status's name, e.g. Todo or Backlog; any case.")),
  json,
}, (input) =>
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
  })).pipe(Command.withDescription("Move a task to a status by name. Into In Review is refused: hand work over with `cello task submit`."))

const comment = Command.make("comment", {
  key,
  text: Argument.String("text").pipe(Argument.optional, Argument.withDescription("The comment, in quotes; markdown renders on the card.")),
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
  })).pipe(Command.withDescription("Add a markdown comment to a task: progress, a question, an answer to Lucas."))

const submit = Command.make("submit", {
  key,
  json,
  summary: Flag.String("summary").pipe(Flag.optional, Flag.withDescription("What changed, in markdown.")),
  summaryFile: Flag.String("summary-file").pipe(Flag.optional, Flag.withDescription("Read the summary from a file; - is stdin.")),
  step: Flag.String("step").pipe(Flag.atLeast(0), Flag.withDescription("How to check the work, one step each; repeat in order.")),
  attach: Flag.String("attach").pipe(
    Flag.atLeast(0),
    Flag.withDescription("A video (MP4), a screenshot, or a text file such as test output or a terminal recording; repeatable."),
  ),
  caption: Flag.String("caption").pipe(Flag.atLeast(0), Flag.withDescription("Describes the --attach or --link right before it.")),
  link: Flag.String("link").pipe(Flag.atLeast(0), Flag.withDescription("A link, e.g. the PR; repeatable.")),
}, (input) =>
  Effect.gen(function* () {
    const summary = yield* bodyText(input.summary, input.summaryFile)
    if (summary === undefined || summary.trim() === "") {
      return yield* new CliFailure({ message: "Say what changed: --summary \"…\", or --summary-file - for markdown from stdin." })
    }
    const { cwd, env } = yield* CliEnv
    const evidence = evidenceFromArgs(yield* CliArgs, cwd)
    if ("error" in evidence) return yield* new CliFailure({ message: evidence.error })
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const before = yield* client["task.get"]({ key: input.key })
        const response = yield* client["review.submit"]({
          commandId: newCommandId(),
          key: input.key,
          summary,
          steps: input.step,
          files: evidence.files,
          links: evidence.links,
        })
        return { before, response }
      })
    )
    if (input.json) return yield* printJson(written.response)
    const { before, response } = written
    const human = before.actors.find((a) => a.kind === "human")?.name ?? "Lucas"
    yield* print([
      `Submitted ${response.result.task.key} for review  ${statusName(before, before.task.statusId)} → ${statusName(before, response.result.task.statusId)}`,
      `  ${packetCounts(response.result.review)}`,
      `  ${human} reviews it at http://127.0.0.1:${portOf(env)}/review`,
    ].join("\n"))
  })).pipe(Command.withDescription("Hand finished work to Lucas: a review packet (summary, steps, evidence) that moves the task to In Review."))

// ── documents ───────────────────────────────────────────────────────────────────────────────────

const KINDS: ReadonlyArray<DocumentKind> = ["page", "doc", "spec"]
const kindFlag = Flag.String("kind").pipe(Flag.optional, Flag.withDescription("page (the default), doc or spec."))

/** The kind from --kind, or undefined; a failure names the real kinds. */
const kindOf = (value: Option.Option<string>) => {
  if (Option.isNone(value)) return Effect.succeed(undefined)
  const kind = KINDS.find((k) => k === value.value.trim().toLowerCase())
  return kind ? Effect.succeed(kind) : Effect.fail(new CliFailure({ message: `No kind "${value.value}". Use page, doc or spec.` }))
}

/** Where the reader shows a document: the web app `cello start` serves on the same port. */
const pageUrl = (env: Env, projectKey: string, slug: string) => `http://127.0.0.1:${portOf(env)}${pagePath(projectKey, slug)}`

const readFile = (file: string) =>
  Effect.tryPromise({ try: () => Bun.file(file).text(), catch: () => new CliFailure({ message: `Can't read ${file}.` }) })

const docPublish = Command.make("publish", {
  file: Argument.String("file").pipe(Argument.withDescription("The markdown file, or - to read it from stdin.")),
  project,
  json,
  title: Flag.String("title").pipe(Flag.optional, Flag.withDescription("Default: the frontmatter title:, the first # heading, or the file name.")),
  slug: Flag.String("slug").pipe(
    Flag.optional,
    Flag.withDescription("The page's slug (its URL); publishing to it again updates it. Default: the page this file went to before, else one from the title."),
  ),
  kind: kindFlag,
  summary: Flag.String("summary").pipe(Flag.optional, Flag.withDescription("Default: the frontmatter summary:, else the first paragraph.")),
  task: Flag.String("task").pipe(Flag.atLeast(0), Flag.withDescription("Link the page to a task, e.g. CEL-12; repeat it, or separate keys with commas.")),
  asset: Flag.String("asset").pipe(
    Flag.atLeast(0),
    Flag.withDescription("Another file to upload with it (images the markdown links go up by themselves); repeatable."),
  ),
}, (input) =>
  Effect.gen(function* () {
    const kind = yield* kindOf(input.kind)
    const { cwd, env, readStdin } = yield* CliEnv
    const ref = yield* projectRef(input.project)
    const source = input.file === "-" ? undefined : path.resolve(cwd, input.file)
    const body = source === undefined ? yield* Effect.promise(readStdin) : yield* readFile(source)
    const files = pageFiles(body, source === undefined ? cwd : path.dirname(source), input.asset, cwd)
    const taskKeys = input.task.flatMap((value) => value.split(",")).map((k) => k.trim()).filter((k) => k !== "")
    const { response, project: found } = yield* withClient((client) =>
      Effect.gen(function* () {
        const response = yield* client["document.publish"]({
          commandId: newCommandId(),
          project: ref,
          body,
          ...(kind === undefined ? {} : { kind }),
          ...(Option.isSome(input.slug) ? { slug: input.slug.value } : {}),
          ...(Option.isSome(input.title) ? { title: input.title.value } : {}),
          ...(Option.isSome(input.summary) ? { summary: input.summary.value } : {}),
          ...(source === undefined ? {} : { sourcePath: source }),
          ...(taskKeys.length ? { taskKeys } : {}),
          ...(files.length ? { files } : {}),
        })
        return { response, project: (yield* client["whoami"]({ project: ref })).project }
      })
    )
    const doc = response.result
    const url = pageUrl(env, found?.key ?? ref.key?.toUpperCase() ?? "", doc.slug)
    if (input.json) return yield* printJson({ ...response, url })
    const what = `${doc.kind} "${doc.title}"`
    if (response.seq === null) return yield* print(`No changes: ${what} is still version ${doc.version}\n${url}`)
    const fresh = doc.version === 1 && doc.createdAt === doc.updatedAt
    const details = [
      ...(doc.tasks.length ? [`linked to ${doc.tasks.map((t) => t.key).join(", ")}`] : []),
      ...(files.length ? [`with ${plural(files.length, "file")}`] : []),
    ]
    const head = fresh ? `Published ${what} (version 1)` : `Updated ${what} to version ${doc.version}`
    yield* print(`${[head, ...details].join(", ")}\n${url}`)
  })).pipe(Command.withDescription("Publish a markdown report, plan or summary as a page in Cello and print its URL."))

const docList = Command.make("list", { project, json, kind: kindFlag }, (input) =>
  Effect.gen(function* () {
    const kind = yield* kindOf(input.kind)
    const ref = yield* projectRef(input.project)
    const result = yield* withClient((client) => client["document.list"]({ project: ref, ...(kind === undefined ? {} : { kind }) }))
    if (input.json) return yield* printJson(result)
    if (result.documents.length === 0) {
      return yield* print(
        `No ${kind ? `${kind}s` : "documents"} in ${result.project.key} yet. Publish one with \`cello doc publish report.md${kind && kind !== "page" ? ` --kind ${kind}` : ""}\`.`,
      )
    }
    const now = (yield* CliEnv).now()
    const linked = result.documents.some((d) => d.tasks.length > 0)
    yield* print(columns(result.documents.map((d) => [
      d.slug,
      d.kind,
      `v${d.version}`,
      d.title,
      ...(linked ? [d.tasks.map((t) => t.key).join(",")] : []),
      ago(d.updatedAt, now),
    ])).join("\n"))
  })).pipe(Command.withDescription("The project's docs, specs and pages, newest first."))

const docGet = Command.make("get", {
  slug: Argument.String("slug").pipe(Argument.withDescription("The page's slug, e.g. billing-audit.")),
  project,
  json,
  version: Flag.Int("version").pipe(Flag.optional, Flag.withDescription("An older version, by number.")),
}, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    const doc = yield* withClient((client) =>
      client["document.get"]({ project: ref, slug: input.slug, ...(Option.isSome(input.version) ? { version: input.version.value } : {}) })
    )
    yield* input.json ? printJson(doc) : print(doc.body)
  })).pipe(Command.withDescription("Print a page's markdown, to read it back or continue from it."))

const docArchive = Command.make("archive", {
  slug: Argument.String("slug").pipe(Argument.withDescription("The page's slug, e.g. billing-audit.")),
  project,
  json,
}, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    const response = yield* withClient((client) => client["document.archive"]({ commandId: newCommandId(), project: ref, slug: input.slug }))
    if (input.json) return yield* printJson(response)
    yield* print(`Archived ${response.result.kind} "${response.result.title}"`)
  })).pipe(Command.withDescription("Hide a page from the Docs tab; its link keeps working, and publishing it again brings it back."))

const doc = Command.make("doc").pipe(
  Command.withDescription("Pages, docs and specs: publish, list, get, archive."),
  Command.withSubcommands([docPublish, docList, docGet, docArchive]),
)

// ── backups ─────────────────────────────────────────────────────────────────────────────────────

const backupLines = (backup: Backup) => [
  `Backed up to ${backup.path}`,
  `  database  ${formatBytes(backup.dbBytes)}`,
  backup.assets.files === 0
    ? "  assets    none yet"
    : `  assets    ${plural(backup.assets.files, "file")}, ${formatBytes(backup.assets.bytes)}: ${backup.assets.linked} linked to the previous backup, ` +
      `${backup.assets.copied} copied (${formatBytes(backup.assets.copiedBytes)} new)`,
]

const backupJson = Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print the backup as JSON (id, path, sizes, file counts) for scripts."))

const backupCreate = Command.make("backup", { json: backupJson }, (input) =>
  Effect.gen(function* () {
    const { env, now } = yield* CliEnv
    const dataDir = dataDirOf(env)
    const taken = yield* withClient(
      (client) => Effect.map(client["backup.create"]({}), (backup) => ({ backup, direct: false })),
      Effect.map(backupOffline({ dataDir }), (backup) => ({ backup, direct: true })),
    ).pipe(
      // The server's disk failing is a defect there, and arrives here as one.
      Effect.catchDefect((defect) =>
        Effect.fail(new CliFailure({ message: explain(new BackupFailed({ dataDir, reason: reasonOf(defect) }), { port: portOf(env), now: now() }) }))
      ),
    )
    if (input.json) return yield* printJson(taken.backup)
    yield* print([
      ...(taken.direct ? [`Cello isn't running, so the backup was taken straight from ${dataDir}.`] : []),
      ...backupLines(taken.backup),
    ].join("\n"))
  })).pipe(Command.withDescription(
    "Back up the database and every evidence file (videos, screenshots, page images) now, into " +
      "<data folder>/backups/<YYYYMMDD-HHMMSS>/, and print the folder, its size and how many files were linked or copied. " +
      "The server already takes one a day and keeps 14 of those; take one by hand before something risky, like a bulk change or " +
      "trying a new build on your real board. Files unchanged since the previous backup become hard links to it, so a " +
      "backup only adds what changed. Talks to the running server on CELLO_PORT; with none running, it backs up " +
      "CELLO_DATA_DIR (default ~/.cello) itself.",
  ), Command.withShortDescription("Back up the database and evidence files now."), Command.withExamples([
    { command: "cello backup", description: "Take a backup now; prints its folder and how many files were linked or copied" },
    { command: "cello backup --json", description: "The same, as JSON for a script" },
    { command: "CELLO_DATA_DIR=/path/to/data cello backup", description: "Back up another data folder (with no server running for it)" },
  ]))

const backupList = Command.make("list", {
  json: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print the backups as a JSON array, newest first, for scripts.")),
}, (input) =>
  Effect.gen(function* () {
    const dataDir = dataDirOf((yield* CliEnv).env)
    const backups = yield* withClient((client) => client["backup.list"]({}), listBackups({ dataDir }))
    if (input.json) return yield* printJson(backups)
    if (backups.length === 0) {
      return yield* print(`No backups in ${path.join(dataDir, BACKUPS_DIR)} yet. Take one with \`cello backup\`; the server also takes one every day.`)
    }
    const noted = backups.some((b) => b.note !== null)
    yield* print(columns(backups.map((b) => [
      b.id,
      localTime(b.createdAt),
      b.kind,
      formatBytes(b.dbBytes + b.assets.bytes),
      plural(b.assets.files, "file"),
      ...(noted ? [b.note ?? ""] : []),
    ])).join("\n"))
  })).pipe(Command.withDescription(
    "List the backups, newest first: the id (the folder name, which `cello restore` takes), when it was taken, its kind " +
      "(auto: the daily one; manual: `cello backup`; safety: the copy of the current state `cello restore` takes first, " +
      "which undoes that restore), its size (the database plus its files, counting files shared with other backups in " +
      "each) and how many evidence files it holds. The newest 14 of each kind are kept. Use it to pick a backup to " +
      "restore. Only Cello's own backups are listed; other folders in backups/ are left alone. Works whether or not " +
      "Cello is running.",
  ), Command.withShortDescription("List the backups, newest first."), Command.withExamples([
    { command: "cello backup list", description: "Every backup: id, time, kind, size and file count" },
    { command: "cello backup list --json | jq -r '.[0].id'", description: "The newest backup's id" },
    { command: "CELLO_DATA_DIR=/path/to/data cello backup list", description: "Another data folder's backups" },
  ]))

const backup = backupCreate.pipe(Command.withSubcommands([backupList]))

const restoreCommand = Command.make("restore", {
  id: Argument.String("id").pipe(Argument.withDescription("The backup to restore: its id from `cello backup list`, e.g. 20261115-120000.")),
  json: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print what was restored, and the safety backup, as JSON.")),
}, (input) =>
  Effect.gen(function* () {
    const { env, now } = yield* CliEnv
    const restored = yield* restore({ dataDir: dataDirOf(env), id: input.id }).pipe(
      Effect.mapError((error) => new CliFailure({ message: explain(error, { port: portOf(env), now: now() }) })),
    )
    if (input.json) return yield* printJson(restored)
    const { backup, safety, assets } = restored
    yield* print([
      `Restored backup ${backup.id} (${backup.kind}, taken ${localTime(backup.createdAt)})`,
      `  database  ${formatBytes(backup.dbBytes)}, schema level ${backup.schemaLevel}`,
      `  assets    ${plural(assets.files, "file")}, ${formatBytes(assets.bytes)}`,
      ...(assets.files < assets.expected
        ? [`  warning   the backup's manifest lists ${assets.expected} evidence files but only ${assets.files} were there to restore ` +
          "(was its assets/ folder changed by hand?); reviews and pages may show missing files."]
        : []),
      safety
        ? `What it replaced is saved as backup ${safety.id}; \`cello restore ${safety.id}\` brings it back.`
        : "The data folder held nothing before, so there was nothing to save.",
      "Start Cello again: `cello start`, or open the desktop app.",
    ].join("\n"))
  })).pipe(Command.withDescription(
    "Put a backup's database and evidence files back in place of the current ones, in CELLO_DATA_DIR (default " +
      "~/.cello). Use it when the board's data is lost or damaged. Stop Cello first (Ctrl-C where `cello start` runs, or " +
      "quit the desktop app): restore refuses while a server holds the data folder. It first takes a safety backup of the " +
      "current state (kind safety, \"before restoring <id>\"), so restoring that one undoes it. Agents run it only when Lucas asks.",
  ), Command.withShortDescription("Put a backup back in place of the current data (stop Cello first)."), Command.withExamples([
    { command: "cello backup list", description: "First, pick the backup to restore" },
    { command: "cello restore 20261115-120000", description: "Restore it; the current state is backed up first" },
    { command: "cello restore 20261115-130501", description: "Undo that restore: restore the \"before restoring\" backup it printed" },
  ]))

const guide = Command.make("guide", {}, () => print(GUIDE)).pipe(
  Command.withDescription("Print the full guide for agents: concepts, workflow, examples, errors and every command (docs/cli.md)."),
)

const task = Command.make("task").pipe(
  Command.withDescription("Tasks: list, get, create, claim, release, move, comment, submit."),
  Command.withSubcommands([list, get, create, claim, release, move, comment, submit]),
)

const startCommand = Command.make("start", {}, () => start).pipe(
  Command.withDescription("Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR)."),
)

export const cello = Command.make("cello").pipe(
  Command.withDescription("A local task board for you and your coding agents."),
  Command.withSubcommands([context, task, doc, whoami, guide, startCommand, backup, restoreCommand]),
)

/**
 * Runs `cello` with these arguments (without the program name). A defect (a failing disk, a bug)
 * still ends in one printed sentence instead of a silent exit.
 */
export const run = (args: ReadonlyArray<string>) =>
  Command.runWith(cello, { version: VERSION })(args).pipe(
    Effect.provideService(CliArgs, args),
    Effect.catchDefect((defect) => Effect.fail(new CliFailure({ message: `Something went wrong: ${reasonOf(defect)}` }))),
  )
