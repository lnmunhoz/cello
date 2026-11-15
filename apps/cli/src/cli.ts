// The `cello` command tree. Each command parses its arguments, makes one RPC call (two when it must
// first turn a task key or a status name into an id, or mark what it shows read), and prints short
// text, or JSON with --json.
import * as path from "node:path"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { describeEvent } from "@cello/client/history"
import type { Actor, AgentSession, DocumentKind, Priority, ProjectRef, Review, Status, Task } from "@cello/contract/entities"
import { pagePath } from "@cello/shared/document"
import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import { HOOK_DEADLINE_MS, HOOK_EVENTS, hookResponse, hookSession, parseHookInput } from "./claudeHook.ts"
import { addCelloHooks, CELLO_HOOKS, type Merged, readSettings, removeCelloHooks, settingsPath, writeSettings } from "./claudeSettings.ts"
import { CliEnv, portOf } from "./env.ts"
import { CliFailure, explain } from "./errors.ts"
import { evidenceFromArgs } from "./evidence.ts"
import { ago, columns, sessionName } from "./format.ts"
import { GUIDE } from "./guide.ts"
import { type Env, IDENTITY_VARIABLES, identityHeaders } from "./identity.ts"
import { deliveryText, inboxEntries } from "./inbox.ts"
import { pageFiles } from "./pageFiles.ts"
import { repoRootFor } from "./repo.ts"
import { start } from "./start.ts"

export { CliEnv } from "./env.ts"

export const VERSION = "0.2.0"

/** The raw arguments, for flags whose order matters (`submit`'s --caption after an --attach). */
class CliArgs extends Context.Service<CliArgs, ReadonlyArray<string>>()("cello/CliArgs") {}

// ── running a call ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs `use` with a client connected as this environment's caller (or as `headers`, for the hook);
 * any failure becomes a CliFailure.
 */
const withClient = <A, E>(
  use: (client: CelloClient["Service"]) => Effect.Effect<A, E | CliFailure, CelloClient>,
  headers?: Readonly<Record<string, string>>,
) =>
  Effect.gen(function* () {
    const { env, cwd, now } = yield* CliEnv
    const port = portOf(env)
    const socket = BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)
    return yield* Effect.flatMap(Effect.service(CelloClient), use).pipe(
      Effect.provide(makeClientLayer(socket, headers ?? identityHeaders(env, cwd))),
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
    // The new comments it shows count as read, so the hook doesn't hand them over a second time.
    const ctx = yield* withClient((client) =>
      Effect.gen(function* () {
        const ctx = yield* client["context"]({ project: ref })
        if (ctx.inbox.length) yield* client["inbox.markRead"]({ ids: ctx.inbox.map((i) => i.id) })
        return ctx
      })
    )
    if (input.json) return yield* printJson(ctx)
    const now = (yield* CliEnv).now()
    const visible = ctx.statuses.filter((s) => !s.hidden).map((s) => s.name)
    const hidden = ctx.statuses.filter((s) => s.hidden).map((s) => s.name)
    const lines = [
      `Project   ${ctx.project.key} · ${ctx.project.name}${ctx.project.repoPath ? ` · ${ctx.project.repoPath}` : ""}`,
      `You       ${ctx.session ? `${sessionName(ctx.session)}${ctx.session.entrypoint ? ` (${ctx.session.entrypoint})` : ""}` : `${ctx.actor.name} (human)`}`,
      `Statuses  ${visible.join(" · ")}${hidden.length ? ` (hidden: ${hidden.join(", ")})` : ""}`,
      `Labels    ${ctx.labels.map((l) => l.name).join(" · ") || "none yet"}`,
    ]
    if (ctx.inbox.length) {
      const sentBack = ctx.inbox.find((i) => i.kind === "send_back")
      lines.push(
        "",
        `New comments for you (${ctx.inbox.length})`,
        ...indent(inboxEntries(ctx.inbox, now)),
        `  Answer on the card: \`cello task comment ${ctx.inbox[0]!.taskKey} "…"\`.`,
        ...(sentBack ? [`  Sent back: fix it, then hand it in again with \`cello task submit ${sentBack.taskKey}\`.`] : []),
      )
    }
    lines.push(
      "",
      "Claimed by you",
      ...(ctx.claimed.length ? taskRows(ctx, ctx.claimed).map((l) => `  ${l}`) : ["  nothing yet: `cello task list`, then `cello task claim KEY`"]),
    )
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
  })).pipe(Command.withDescription("Start here: the project, its statuses and labels, new comments for you, your claims and recent activity."))

/** Lines indented by two spaces; blank lines stay blank. */
const indent = (lines: ReadonlyArray<string>) => lines.map((l) => (l === "" ? l : `  ${l}`))

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
  })).pipe(Command.withDescription("One task: description, labels, comments, history."))

const create = Command.make("create", {
  title: Argument.String("title"),
  project,
  json,
  description: Flag.String("description").pipe(Flag.optional),
  bodyFile: Flag.String("body-file").pipe(Flag.optional, Flag.withDescription("Read the description from a file; - is stdin.")),
  status: Flag.String("status").pipe(Flag.optional),
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

const docArchive = Command.make("archive", { slug: Argument.String("slug"), project, json }, (input) =>
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

// ── comments for agents (CEL-15) ────────────────────────────────────────────────────────────────

const inbox = Command.make("inbox", {
  onlyNew: Flag.Boolean("new").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Only new comments, and print nothing (exit 0) when there are none. For scripts and hooks."),
  ),
  json: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print the inbox as JSON, as it was before reading.")),
}, (input) =>
  Effect.gen(function* () {
    // Marked read before it's printed: whatever this prints never comes back through the hook.
    const read = yield* withClient((client) =>
      Effect.gen(function* () {
        const inbox = yield* client["inbox.list"](input.onlyNew ? { unreadOnly: true } : {})
        const fresh = inbox.items.filter((i) => i.readAt === null)
        if (fresh.length) yield* client["inbox.markRead"]({ ids: fresh.map((i) => i.id) })
        return inbox
      })
    )
    if (input.json) return yield* printJson(read)
    const now = (yield* CliEnv).now()
    const fresh = read.items.filter((i) => i.readAt === null)
    if (input.onlyNew) return fresh.length ? yield* print(deliveryText(fresh, now)) : undefined
    if (read.session === null) {
      return yield* print(
        "The human has no inbox: comments reach the agent session that claimed the task. Run this from an agent session (CLAUDE_CODE_SESSION_ID or CELLO_SESSION set).",
      )
    }
    const earlier = read.items.filter((i) => i.readAt !== null)
    const lines = [fresh.length ? deliveryText(fresh, now) : `No new comments for ${sessionName(read.session)}.`]
    if (earlier.length) lines.push("", "Earlier", ...indent(inboxEntries(earlier, now)))
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription(
    "Show the comments Lucas left on tasks this session claimed (Send back notes too) and mark them read. " +
      "Use it when `cello context` says there are new ones, or to reread what he said; with `cello install claude` they arrive by themselves.",
  ))

const hookClaude = Command.make("claude", {
  event: Argument.Literals("event", HOOK_EVENTS).pipe(
    Argument.withDescription("The hook event Claude Code runs it for: stop (Stop) or post-tool-use (PostToolUse)."),
  ),
}, (input) =>
  Effect.gen(function* () {
    const { env, cwd, now, readStdin } = yield* CliEnv
    const hook = parseHookInput(yield* Effect.promise(readStdin))
    const session = hookSession(hook, env)
    // A subagent's tool calls carry its parent's session; leave the comments for the main conversation.
    if (hook.inSubagent || session === null) return
    const headers = identityHeaders({ ...env, CELLO_SESSION: undefined, CLAUDE_CODE_SESSION_ID: session }, hook.cwd ?? cwd)
    // Marked read before they're printed, so a comment is never handed over twice and a Stop hook
    // can't loop on it (stop_hook_active needs no special case).
    const fresh = yield* withClient((client) =>
      Effect.gen(function* () {
        const { items } = yield* client["inbox.list"]({ unreadOnly: true })
        if (items.length) yield* client["inbox.markRead"]({ ids: items.map((i) => i.id) })
        return items
      }), headers)
    if (fresh.length) yield* print(JSON.stringify(hookResponse(input.event, deliveryText(fresh, now()))))
  }).pipe(
    // It must never break or stall the session: a slow or missing server, bad input, anything, is silence and exit 0.
    Effect.timeout(HOOK_DEADLINE_MS),
    Effect.catchCause(() => Effect.void),
  )).pipe(Command.withDescription(
    "Run by the hooks `cello install claude` adds, not by hand: reads Claude Code's hook JSON on stdin and hands new comments " +
      "for its session back to the agent (Stop: keeps it going; PostToolUse: adds them as context). Prints nothing when there are none.",
  ))

const hook = Command.make("hook").pipe(
  Command.withDescription("Hooks for agent hosts; `cello hook claude <event>` is what `cello install claude` puts in Claude Code's settings."),
  Command.withSubcommands([hookClaude]),
)

const userFlag = Flag.Boolean("user").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Your user settings, ~/.claude/settings.json (every project), instead of this project's .claude/settings.json."),
)

/** Reads a Claude Code settings file, changes it with `change`, and writes it back if anything changed. */
const updateSettings = (user: boolean, change: (settings: unknown) => Merged) =>
  Effect.gen(function* () {
    const { env, cwd } = yield* CliEnv
    const file = yield* Effect.try({
      try: () => settingsPath({ user, home: env.HOME, cwd }),
      catch: (e) => new CliFailure({ message: `${(e as Error).message}.` }),
    })
    const merged = yield* Effect.try({
      try: () => change(readSettings(file)),
      catch: (e) => new CliFailure({ message: `Can't update ${file}: ${(e as Error).message}. Fix it first; Cello won't overwrite it.` }),
    })
    if (merged.changed) {
      yield* Effect.try({
        try: () => writeSettings(file, merged.settings),
        catch: (e) => new CliFailure({ message: `Can't write ${file}: ${(e as Error).message}.` }),
      })
    }
    return { file, changed: merged.changed }
  })

const installClaude = Command.make("claude", { user: userFlag }, (input) =>
  Effect.gen(function* () {
    const { file, changed } = yield* updateSettings(input.user, addCelloHooks)
    if (!changed) return yield* print(`Cello's Claude Code hooks are already in ${file}.`)
    const { env } = yield* CliEnv
    const lines = [
      `Installed Cello's Claude Code hooks in ${file}:`,
      ...indent(columns(CELLO_HOOKS.map((h) => [h.event, h.command]))),
      "Your comments and Send back notes on a task an agent session claimed now reach that session: when it stops, and after each tool call.",
      "New Claude Code sessions pick them up.",
    ]
    if (Bun.which("cello", { PATH: env.PATH ?? "" }) === null) {
      lines.push(
        "`cello` isn't on your PATH, so Claude Code can't run the hooks. Put the cello binary on the PATH Claude Code starts with (e.g. ~/.local/bin).",
      )
    }
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription(
    "Add Claude Code hooks that deliver new comments into the agent session holding the task (Stop and PostToolUse, running " +
      "`cello hook claude`). Merges with the hooks already there; running it again changes nothing. Once per project, or once with --user.",
  ))

const uninstallClaude = Command.make("claude", { user: userFlag }, (input) =>
  Effect.gen(function* () {
    const { file, changed } = yield* updateSettings(input.user, removeCelloHooks)
    yield* print(changed ? `Removed Cello's Claude Code hooks from ${file}.` : `No Cello hooks in ${file}.`)
  })).pipe(Command.withDescription("Take Cello's hooks out of Claude Code's settings, leaving every other hook and setting as it was."))

const install = Command.make("install").pipe(
  Command.withDescription("Connect an agent host to Cello: `cello install claude` adds the Claude Code hooks."),
  Command.withSubcommands([installClaude]),
)

const uninstall = Command.make("uninstall").pipe(
  Command.withDescription("Undo `cello install`: `cello uninstall claude` removes the Claude Code hooks."),
  Command.withSubcommands([uninstallClaude]),
)

const guide = Command.make("guide", {}, () => print(GUIDE)).pipe(Command.withDescription("How agents work with Cello."))

const task = Command.make("task").pipe(
  Command.withDescription("Tasks: list, get, create, claim, release, move, comment, submit."),
  Command.withSubcommands([list, get, create, claim, release, move, comment, submit]),
)

const startCommand = Command.make("start", {}, () => start).pipe(
  Command.withDescription("Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR)."),
)

export const cello = Command.make("cello").pipe(
  Command.withDescription("A local task board for you and your coding agents."),
  Command.withSubcommands([context, task, inbox, doc, whoami, guide, install, uninstall, hook, startCommand]),
)

/** Runs `cello` with these arguments (without the program name). */
export const run = (args: ReadonlyArray<string>) =>
  Command.runWith(cello, { version: VERSION })(args).pipe(Effect.provideService(CliArgs, args))
