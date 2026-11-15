// The `cello` command tree. Each command parses its arguments, makes one RPC call (two when it must
// first turn a task key or a status name into an id, or mark what it shows read), and prints short
// text, or JSON with --json.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as BunSocket from "@effect/platform-bun/BunSocket"
import { CelloClient, makeClientLayer, newCommandId } from "@cello/client/client"
import { describeEvent } from "@cello/client/history"
import { STAGE_IDS, stageInfo, TASK_STAGES } from "@cello/contract/stages"
import type { Backup } from "@cello/contract/backups"
import type { Actor, AgentSession, Ask, DocumentKind, InboxItem, Priority, ProjectRef, Review, Status, Task } from "@cello/contract/entities"
import { BACKUPS_DIR } from "@cello/server/backup/BackupService"
import { BackupFailed, backupOffline, listBackups, reasonOf, restore } from "@cello/server/backup/offline"
import { ACCEPTED } from "@cello/shared/attachment"
import { pagePath } from "@cello/shared/document"
import { formatBytes } from "@cello/shared/bytes"
import { shortCommit } from "@cello/shared/build"
import { APP_VERSION } from "@cello/shared/version"
import * as Console from "effect/Console"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Argument from "effect/cli/Argument"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import { addAgentsSection, agentsFile } from "./agentsMd.ts"
import { roundLabel } from "@cello/client/sync/asks"
import { answerLines, answerScreenshots, askResultText, askSpecFromArgs, askSpecFromFile, roundsText } from "./ask.ts"
import { buildsText } from "./builds.ts"
import {
  ALLOW_ARTIFACTS_VARIABLE,
  artifactGuard,
  HOOK_EVENTS,
  type HookEvent,
  hookAction,
  hookDeadline,
  hookResponse,
  hookSession,
  parseHookInput,
} from "./claudeHook.ts"
import {
  addCelloHooks,
  celloHooksFor,
  ensureGitIgnored,
  formatSettings,
  type Merged,
  readSettingsFile,
  removeCelloHooks,
  settingsPaths,
  writeFileAtomically,
} from "./claudeSettings.ts"
import { CliEnv, dataDirOf, portOf } from "./env.ts"
import { CliFailure, explain } from "./errors.ts"
import { evidenceFromArgs } from "./evidence.ts"
import { ago, columns, localTime, sessionName } from "./format.ts"
import { GUIDE } from "./guide.ts"
import { type Env, IDENTITY_VARIABLES, identityHeaders } from "./identity.ts"
import { deliveryText, inboxEntries } from "./inbox.ts"
import { pageFiles } from "./pageFiles.ts"
import { checkoutRootFor, repoRootFor } from "./repo.ts"
import { start } from "./start.ts"

export { CliEnv } from "./env.ts"

export const VERSION = APP_VERSION

/** What `cello --version` prints: "0.2.0 (build c602f25)", "(build dev)" when the commit is unknown. */
const versionText = (build: CliEnv["Service"]["build"]) => build ? `${VERSION} (build ${shortCommit(build.commit)})` : VERSION

/** The raw arguments, for flags whose order matters (`submit`'s --caption after an --attach). */
class CliArgs extends Context.Service<CliArgs, ReadonlyArray<string>>()("cello/CliArgs") {}

// ── running a call ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs `use` with a client connected as this environment's caller (or as `headers`, for the hook);
 * any failure becomes a CliFailure. `whenDown` runs instead when no server answers on CELLO_PORT;
 * without it, that's a failure too.
 */
const withClient = <A, E, B = never>(
  use: (client: CelloClient["Service"]) => Effect.Effect<A, E | CliFailure, CelloClient>,
  options: { readonly headers?: Readonly<Record<string, string>>; readonly whenDown?: Effect.Effect<B, unknown, CliEnv> } = {},
) =>
  Effect.gen(function* () {
    const { env, cwd, now } = yield* CliEnv
    const port = portOf(env)
    const socket = BunSocket.layerWebSocket(`ws://127.0.0.1:${port}/rpc`)
    return yield* Effect.flatMap(Effect.service(CelloClient), use).pipe(
      Effect.provide(makeClientLayer(socket, options.headers ?? identityHeaders(env, cwd))),
      Effect.catch((error): Effect.Effect<A | B, unknown, CliEnv> =>
        options.whenDown !== undefined && Predicate.isTagged(error, "RpcClientError") ? options.whenDown : Effect.fail(error)),
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

const KIND_LISTS = { status: "Statuses", label: "Labels", workspace: "Workspaces" } as const

/** One id from a list by name, ignoring case, or a failure listing the real names. */
const byName = <T extends { readonly id: string; readonly name: string }>(kind: keyof typeof KIND_LISTS, rows: ReadonlyArray<T>, name: string) => {
  const found = rows.find((row) => row.name.trim().toLowerCase() === name.trim().toLowerCase())
  return found
    ? Effect.succeed(found)
    : Effect.fail(new CliFailure({ message: `No ${kind} named "${name}". ${KIND_LISTS[kind]}: ${rows.map((r) => r.name).join(", ") || "none yet"}.` }))
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

/** "In Progress", or "In Progress · Agent review" while the task has a stage (CEL-35). */
const statusWithStage = (names: Names, task: Task) => {
  const stage = task.stage === null ? undefined : stageInfo(task.stage)
  return stage ? `${statusName(names, task.statusId)} · ${stage.label}` : statusName(names, task.statusId)
}

const taskRows = (names: Names, tasks: ReadonlyArray<Task>) =>
  columns(tasks.map((t) => {
    const claim = claimOf(names, t)
    return [t.key, statusWithStage(names, t), claim ? `${t.title}  · ${claim}` : t.title]
  }))

const taskLine = (names: Names, task: Task) => `${task.key}  ${statusWithStage(names, task)}  ${task.title}`

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

/** "a", "a and b", "a, b and c". */
const andList = (items: ReadonlyArray<string>) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

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
    const { env, cwd, build } = yield* CliEnv
    const repoRoot = repoRootFor(cwd)
    const ref: ProjectRef = Option.isSome(input.project) ? { key: input.project.value } : repoRoot ? { repoPath: repoRoot } : {}
    const server = yield* withClient((client) =>
      Effect.map(
        Effect.all([client["whoami"]({ project: ref }), client["server.build"]({})]),
        ([who, serverBuild]) => ({ ...who, build: serverBuild }),
      )
    ).pipe(
      Effect.catch((failure) => Effect.succeed({ error: failure.message })),
    )
    yield* printJson({
      variables: Object.fromEntries(IDENTITY_VARIABLES.flatMap((name) => (env[name] ? [[name, env[name]]] : []))),
      headers: identityHeaders(env, cwd),
      cwd,
      repoRoot,
      cli: { version: VERSION, commit: build?.commit ?? null },
      server,
    })
  })).pipe(Command.withDescription("Print, as JSON, who Cello thinks is calling, and which build the CLI and the server are."))

const context = Command.make("context", { project, json }, (input) =>
  Effect.gen(function* () {
    const ref = yield* projectRef(input.project)
    // New comments are shown, not taken: subagents run this as their parent's session.
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
    ]
    if (ctx.inbox.length) {
      const sentBack = ctx.inbox.find((i) => i.kind === "send_back")
      const answered = ctx.inbox.find((i) => i.kind === "answers")
      lines.push(
        "",
        `${answered ? "New for you" : "New comments for you"} (${ctx.inbox.length})`,
        ...indent(inboxEntries(ctx.inbox, now, undefined, yield* saveScreenshots(answeredAsks(ctx.inbox)))),
        `  Answer on the card: \`cello task comment ${ctx.inbox[0]!.taskKey} "…"\`. They stay new until the hook or \`cello inbox\` hands them over.`,
        ...(sentBack ? [`  Sent back: fix it, then hand it in again with \`cello task submit ${sentBack.taskKey}\`.`] : []),
        ...(answered ? [`  Answered: ${answered.taskKey} is back in progress; carry on with the answers.`] : []),
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
    const stage = task.stage === null ? undefined : stageInfo(task.stage)
    const changed = task.updatedByActorId === null ? null : author(detail, task.updatedByActorId, task.updatedBySessionId)
    const lines = [
      `${task.key}  ${task.title}`,
      `Status: ${statusName(detail, task.statusId)}${stage ? ` · Stage: ${stage.label}` : ""} · Priority: ${PRIORITY_NAMES[task.priority]}` +
      `${labels.length ? ` · Labels: ${labels.join(", ")}` : ""}`,
      ...(claim ? [`Claimed by: ${claim}`] : task.assigneeActorId ? [`Assigned to: ${author(detail, task.assigneeActorId, null)}`] : []),
      `Created by ${author(detail, task.createdByActorId, task.createdBySessionId)}, ${ago(task.createdAt, now)}`,
      ...(changed && task.version > 1 ? [`Last changed by ${changed}, ${ago(task.updatedAt, now)}`] : []),
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
    if (detail.asks.length) {
      lines.push("", `Questions for ${humanName(detail.actors)} (${detail.asks.length})`)
      for (const a of [...detail.asks].reverse()) {
        const when = a.state === "answered" ? ` ${ago(a.answeredAt!, now)}` : a.withdrawnAt ? ` ${ago(a.withdrawnAt, now)}` : ""
        lines.push(`  ${roundLabel(detail.asks, a)}${when}: "${a.title}", asked by ${author(detail, a.actorId, a.sessionId)}, ${ago(a.createdAt, now)}`)
        if (a.answers) lines.push(...answerLines(a, new Map()).map((l) => (l === "" ? "" : `    ${l}`)))
        else lines.push(...a.questions.map((q, i) => `    ${i + 1}. ${q.prompt}`))
      }
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

const STAGE_NAMES = andList(STAGE_IDS.map(String)).replace(" and ", " or ")

const stage = Command.make("stage", {
  key,
  stage: Argument.String("stage").pipe(
    Argument.optional,
    Argument.withDescription(`Where the work is: ${TASK_STAGES.map((s) => `${s.id} (${s.when})`).join(", ")}.`),
  ),
  clear: Flag.Boolean("clear").pipe(Flag.withDefault(false), Flag.withDescription("Remove the stage instead.")),
  json,
}, (input) =>
  Effect.gen(function* () {
    const named = Option.getOrUndefined(input.stage)?.trim().toLowerCase()
    if (named !== undefined && input.clear) return yield* new CliFailure({ message: "Pass a stage or --clear, not both." })
    if (named === undefined && !input.clear) {
      return yield* new CliFailure({
        message: `Name a stage: ${STAGE_NAMES} (e.g. \`cello task stage ${input.key.toUpperCase()} review\`), or --clear to remove it.`,
      })
    }
    const next = named === undefined ? null : STAGE_IDS.find((id) => id === named)
    if (next === undefined) return yield* new CliFailure({ message: `No stage "${named}". Use ${STAGE_NAMES}.` })
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const response = yield* client["task.stage"]({ commandId: newCommandId(), key: input.key, stage: next })
        return { response, names: yield* client["task.get"]({ key: response.result.key }) }
      })
    )
    if (input.json) return yield* printJson(written.response)
    const task = written.response.result
    const where = `(${statusName(written.names, task.statusId)}  ${task.title})`
    yield* print(next === null ? `Cleared the stage of ${task.key}  ${where}` : `${task.key} is now ${stageInfo(next)!.label}  ${where}`)
  })).pipe(Command.withDescription(
    "Say where your claimed task is inside In Progress, so the board shows it: building, agent review, fixing findings, merged. " +
      "Only the session holding the claim (or Lucas), only in In Progress. Asking Lucas (Needs input) keeps it; any other move out of In Progress, or submitting it, clears it.",
  ))

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

// ── needs input (CEL-47) ────────────────────────────────────────────────────────────────────────

/**
 * Saves the screenshots Lucas pasted into answers to a temp folder (agents never read the data folder
 * directly), fetched from the server: `<tmp>/cello-answers/<ask id>/q1-1.png`. Returns attachment id →
 * path; one that can't be fetched is left out (the text then shows its URL path).
 */
const saveScreenshots = (asks: ReadonlyArray<Ask>) =>
  Effect.gen(function* () {
    const { env } = yield* CliEnv
    const saved = new Map<string, string>()
    for (const ask of asks) {
      for (const { attachment, fileName } of answerScreenshots(ask)) {
        const file = path.join(os.tmpdir(), "cello-answers", ask.id, fileName)
        const ok = yield* Effect.promise(async () => {
          try {
            const response = await fetch(`http://127.0.0.1:${portOf(env)}/attachments/${attachment.id}`)
            if (!response.ok) return false
            fs.mkdirSync(path.dirname(file), { recursive: true })
            await Bun.write(file, await response.arrayBuffer())
            return true
          } catch {
            return false
          }
        })
        if (ok) saved.set(attachment.id, file)
      }
    }
    return saved as ReadonlyMap<string, string>
  })

const humanName = (actors: ReadonlyArray<Actor>) => actors.find((a) => a.kind === "human")?.name ?? "Lucas"

/** Waits for the task's latest ask to close, then prints the answers (screenshots saved as files) or why there are none. */
const waitAndPrint = (key: string, json: boolean) =>
  Effect.gen(function* () {
    const { ask, detail } = yield* withClient((client) =>
      Effect.gen(function* () {
        const ask = yield* client["ask.wait"]({ key })
        return { ask, detail: yield* client["task.get"]({ key }) }
      })
    )
    const files = yield* saveScreenshots([ask])
    if (json) return yield* printJson({ ask, files: Object.fromEntries(files) })
    yield* print(askResultText(ask, detail.task.key, humanName(detail.actors), files, (yield* CliEnv).now()))
  })

const ask = Command.make("ask", {
  key,
  json,
  file: Flag.String("file").pipe(
    Flag.optional,
    Flag.withDescription("Read the title, intro, questions and evidence from a JSON or YAML file (the format is in `cello guide`); paths in it are relative to the file."),
  ),
  title: Flag.String("title").pipe(Flag.optional, Flag.withDescription("What the decision is about, e.g. \"Search layout\". Overrides the file's.")),
  intro: Flag.String("intro").pipe(Flag.optional, Flag.withDescription("Context in markdown, shown above the questions.")),
  question: Flag.String("question").pipe(Flag.atLeast(0), Flag.withDescription("A question; the --kind, --option, --recommend and --because after it belong to it.")),
  kind: Flag.String("kind").pipe(
    Flag.atLeast(0),
    Flag.withDescription("one (Lucas picks one option; the default with options), any (any number) or text (no options; the default without)."),
  ),
  option: Flag.String("option").pipe(Flag.atLeast(0), Flag.withDescription("An option: \"Label\" or \"Label|one-line description\"; repeat in order.")),
  recommend: Flag.String("recommend").pipe(Flag.atLeast(0), Flag.withDescription("The label of the option you recommend; --because must follow.")),
  because: Flag.String("because").pipe(Flag.atLeast(0), Flag.withDescription("Why you recommend it, right after --recommend.")),
  attach: Flag.String("attach").pipe(Flag.atLeast(0), Flag.withDescription("A screenshot, video or text file to decide from; repeatable.")),
  caption: Flag.String("caption").pipe(Flag.atLeast(0), Flag.withDescription("Describes the --attach or --link right before it.")),
  link: Flag.String("link").pipe(Flag.atLeast(0), Flag.withDescription("A link to decide from, e.g. the scope page; repeatable.")),
  wait: Flag.Boolean("wait").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Block until Lucas answers (or the ask is withdrawn), then print the answers. Run it in the background."),
  ),
  withdraw: Flag.Boolean("withdraw").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Take back the open ask instead: the task returns to In Progress."),
  ),
}, (input) =>
  Effect.gen(function* () {
    const { cwd, env } = yield* CliEnv
    if (input.withdraw) {
      const response = yield* withClient((client) => client["ask.withdraw"]({ commandId: newCommandId(), key: input.key }))
      if (input.json) return yield* printJson(response)
      return yield* print(`Withdrew the questions on ${response.result.task.key} ("${response.result.ask.title}"); it's back in progress.`)
    }
    const args = yield* CliArgs
    const inline = askSpecFromArgs(args, cwd)
    if ("error" in inline) return yield* new CliFailure({ message: inline.error })
    let spec = inline
    if (Option.isSome(input.file)) {
      if (inline.questions.length) return yield* new CliFailure({ message: "Ask from --file or with --question flags, not both." })
      const file = path.resolve(cwd, input.file.value)
      const fromFile = askSpecFromFile(yield* readFile(file), file)
      if ("error" in fromFile) return yield* new CliFailure({ message: fromFile.error })
      spec = {
        title: inline.title ?? fromFile.title,
        intro: inline.intro ?? fromFile.intro,
        questions: fromFile.questions,
        files: [...fromFile.files, ...inline.files],
        links: [...fromFile.links, ...inline.links],
      }
    }
    if (spec.questions.length === 0) {
      return yield* new CliFailure({ message: `Ask something: --question "…" with --option flags, or --file ask.json. See \`cello guide\`.` })
    }
    if (spec.title === null || spec.title.trim() === "") return yield* new CliFailure({ message: "Give the ask a --title (or a title: in the file)." })
    const written = yield* withClient((client) =>
      Effect.gen(function* () {
        const before = yield* client["task.get"]({ key: input.key })
        const response = yield* client["ask.create"]({
          commandId: newCommandId(),
          key: input.key,
          title: spec.title!,
          ...(spec.intro ? { intro: spec.intro } : {}),
          questions: spec.questions,
          files: spec.files,
          links: spec.links,
        })
        return { before, response }
      })
    )
    const { before, response } = written
    if (input.json && !input.wait) return yield* printJson(response)
    const { ask: created, task } = response.result
    const human = humanName(before.actors)
    if (!input.json) {
      yield* print([
        `Asked ${human} on ${task.key}: "${created.title}" (${plural(created.questions.length, "question")})  ${statusName(before, before.task.statusId)} → ${statusName(before, task.statusId)}`,
        `  ${human} answers at http://127.0.0.1:${portOf(env)}/review?open=${task.key}`,
        input.wait
          ? "  Waiting for the answers…"
          : `  The answers reach this session through the hook, or run \`cello wait ${task.key}\`.`,
      ].join("\n"))
    }
    if (input.wait) yield* waitAndPrint(task.key, input.json)
  })).pipe(Command.withDescription(
    "Ask Lucas to decide something, on the card: questions with options (one recommended, with a reason) and evidence. " +
      "The task moves to Needs input until he answers; then it's back in In Progress and the answers reach you (hook, --wait or `cello wait`).",
  ))

const answers = Command.make("answers", {
  key,
  json,
  all: Flag.Boolean("all").pipe(Flag.withDefault(false), Flag.withDescription("Every round of questions on the task, oldest first, not only the latest answers.")),
}, (input) =>
  Effect.gen(function* () {
    // `task.get` carries every ask of the task, oldest first: one per round.
    const detail = yield* withClient((client) => client["task.get"]({ key: input.key }))
    const shown = input.all ? detail.asks : detail.asks.filter((a) => a.state === "answered").slice(-1)
    const files = yield* saveScreenshots(shown)
    if (input.json) return yield* printJson({ asks: shown, files: Object.fromEntries(files) })
    yield* print(roundsText(detail.asks, { all: input.all, taskKey: detail.task.key, human: humanName(detail.actors), files, now: (yield* CliEnv).now() }))
  })).pipe(Command.withDescription(
    "Print Lucas's latest answers on a task again (--all: every round of questions); screenshots he pasted are saved to files and their paths printed.",
  ))

const waitCommand =Command.make("wait", { key, json }, (input) => waitAndPrint(input.key, input.json)).pipe(
  Command.withDescription("Wait for Lucas to answer the task's open ask (after a restart, say), then print the answers. Returns at once when it's already answered."),
)

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
    Flag.withDescription("Another file to upload with it (files the markdown links go up by themselves); repeatable."),
  ),
}, (input) =>
  Effect.gen(function* () {
    const kind = yield* kindOf(input.kind)
    const { cwd, env, readStdin } = yield* CliEnv
    const ref = yield* projectRef(input.project)
    const source = input.file === "-" ? undefined : path.resolve(cwd, input.file)
    const body = source === undefined ? yield* Effect.promise(readStdin) : yield* readFile(source)
    const { files, skipped } = pageFiles(body, source === undefined ? cwd : path.dirname(source), input.asset, cwd)
    for (const { target, file, reason } of skipped) {
      const why = reason === "missing" ? `isn't there (${file})` : `can't go up with the page (Cello stores ${ACCEPTED})`
      yield* Console.error(`Warning: ${target} ${why}, so the page shows that link as a missing file.`)
    }
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
      { whenDown: Effect.map(backupOffline({ dataDir }), (backup) => ({ backup, direct: true })) },
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
    const backups = yield* withClient((client) => client["backup.list"]({}), { whenDown: listBackups({ dataDir }) })
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

// ── build history (CEL-50) ──────────────────────────────────────────────────────────────────────

const buildsCommand = Command.make("builds", {
  limit: Flag.Int("limit").pipe(Flag.withDefault(20), Flag.withDescription("How many builds to list, newest first (1 to 200).")),
  before: Flag.Int("before").pipe(
    Flag.optional,
    Flag.withDescription("List the builds older than this build number: the number the previous list's \"Older builds\" line gives."),
  ),
  json: Flag.Boolean("json").pipe(Flag.withDefault(false), Flag.withDescription("Print the page as JSON (builds, running, next) for scripts.")),
}, (input) =>
  Effect.gen(function* () {
    const page = yield* withClient((client) =>
      client["builds.list"]({ limit: input.limit, ...(Option.isSome(input.before) ? { before: input.before.value } : {}) }))
    if (input.json) return yield* printJson(page)
    yield* print(buildsText(page, (yield* CliEnv).now()))
  })).pipe(Command.withDescription(
    "List the builds of Cello the server has run, newest first: each build's number, commit and version, when it went live " +
      "and for how long (until the next build went live), which one is running now, and the commits merged since the build " +
      "before it (merge subjects name their tasks). The server records a build the first time it starts on it; restarting the " +
      "same build adds nothing. Use it to tell whether a merged task is deployed yet, or what a deploy brought in.",
  ), Command.withShortDescription("List the builds the server has run, newest first, with what changed."), Command.withExamples([
    { command: "cello builds", description: "The newest 20 builds, with their changes" },
    { command: "cello builds --limit 5", description: "Only the newest 5" },
    { command: "cello builds --before 12", description: "The builds before #12 (the next page)" },
    { command: "cello builds --limit 1 --json | jq -r '.builds[0].changes[]'", description: "What the newest build brought in, one commit per line" },
  ]))

// ── comments for agents (CEL-15) ────────────────────────────────────────────────────────────────

const inbox = Command.make("inbox", {
  onlyNew: Flag.Boolean("new").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Only new comments, and print nothing (exit 0) when there are none. For scripts and hooks."),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print JSON: `items` (new, handed over now and marked read) and `earlier` (read before)."),
  ),
}, (input) =>
  Effect.gen(function* () {
    // One call takes the new comments and marks them read, so nothing else (the hook) gets them again.
    const taken = yield* withClient((client) => client["inbox.take"](input.onlyNew ? { unreadOnly: true } : {}))
    if (input.json) return yield* printJson(taken)
    const now = (yield* CliEnv).now()
    const files = yield* saveScreenshots(answeredAsks([...taken.items, ...taken.earlier]))
    if (input.onlyNew) return taken.items.length ? yield* print(deliveryText(taken.items, now, files)) : undefined
    if (taken.session === null) {
      return yield* print(
        "The human has no inbox: comments reach the agent session that claimed the task. Run this from an agent session (CLAUDE_CODE_SESSION_ID or CELLO_SESSION set).",
      )
    }
    const lines = [taken.items.length ? deliveryText(taken.items, now, files) : `No new comments for ${sessionName(taken.session)}.`]
    if (taken.earlier.length) lines.push("", "Earlier", ...indent(inboxEntries(taken.earlier, now, undefined, files)))
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription(
    "Show the comments Lucas left on tasks this session claimed (Send back notes and answers to your asks too) and mark them read; each one arrives once. " +
      "Use it when `cello context` lists new ones, or to reread what he said. With `cello install claude` they arrive by themselves. " +
      "Not from a subagent: it shares its parent's session and would take the parent's comments.",
  ))

/** What the comment hooks do: take the new comments for the session on stdin and print them for Claude Code. */
const deliverToClaude = (event: Exclude<HookEvent, "pre-tool-use">) =>
  Effect.gen(function* () {
    const { env, cwd, now, readStdin } = yield* CliEnv
    const hook = parseHookInput(yield* Effect.promise(readStdin))
    const action = hookAction(hook, env)
    if (action === "nothing") return
    const headers = identityHeaders({ ...env, CELLO_SESSION: undefined, CLAUDE_CODE_SESSION_ID: hookSession(hook, env)! }, hook.cwd ?? cwd)
    // A subagent's tool calls carry its parent's session: check the session in (any call does) and
    // leave the comments for the main conversation.
    if (action === "check-in") return yield* withClient((client) => client["whoami"]({ project: {} }), { headers }).pipe(Effect.asVoid)
    // Taken and marked read in one step: a comment is handed over once, even to hooks running at the
    // same time, and a Stop hook can't loop on it (stop_hook_active needs no special case).
    const { items } = yield* withClient((client) => client["inbox.take"]({ unreadOnly: true }), { headers })
    if (items.length) yield* print(JSON.stringify(hookResponse(event, deliveryText(items, now(), yield* saveScreenshots(answeredAsks(items))))))
  })

/** The asks whose answers are among these inbox items. */
const answeredAsks = (items: ReadonlyArray<InboxItem>) => items.flatMap((i) => (i.kind === "answers" ? [i.ask] : []))

/** What the artifact guard does (CEL-57): denies a Claude artifact publish, pointing to `cello doc publish`. No server needed. */
const guardArtifacts = Effect.gen(function* () {
  const { env, readStdin } = yield* CliEnv
  const answer = artifactGuard(parseHookInput(yield* Effect.promise(readStdin)), env)
  if (answer) yield* print(JSON.stringify(answer))
})

const hookClaude = Command.make("claude", {
  event: Argument.Literals("event", HOOK_EVENTS).pipe(
    Argument.withDescription(
      "The hook event Claude Code runs it for: stop (Stop), post-tool-use (PostToolUse) or pre-tool-use (PreToolUse, the Artifact guard).",
    ),
  ),
}, (input) =>
  Effect.gen(function* () {
    const { env, exit } = yield* CliEnv
    const work = input.event === "pre-tool-use" ? guardArtifacts : deliverToClaude(input.event)
    // It must never break or stall the session: a slow or missing server, bad input, anything, is silence and exit 0.
    yield* work.pipe(Effect.timeout(hookDeadline(env)), Effect.catchCause(() => Effect.void))
    // An explicit end: a stdin that never closes would otherwise keep the process alive.
    exit?.(0)
  })).pipe(Command.withDescription(
    "Run by the hooks `cello install claude` adds, not by hand: reads Claude Code's hook JSON on stdin. stop and post-tool-use hand " +
      "new comments for its session back to the agent as context (on Stop it keeps the agent going); every run checks the session in, so the board shows it working; they print nothing " +
      "when there are none, inside a subagent (which only checks in), or when the server doesn't answer within 2 seconds. pre-tool-use turns a Claude artifact publish " +
      "away with a pointer to `cello doc publish`, and lets every other call through (all of them with CELLO_ALLOW_ARTIFACTS=1); it " +
      "needs no server. Always exits 0.",
  ))

const hook = Command.make("hook").pipe(
  Command.withDescription("Hooks for agent hosts; `cello hook claude <event>` is what `cello install claude` puts in Claude Code's settings."),
  Command.withSubcommands([hookClaude]),
)

const SCOPES = {
  local: "this machine only",
  shared: "shared: committed with the repo",
  user: "every project",
} as const

/** This project's root (the main checkout, also from a linked worktree; else the folder) and the settings files. */
const claudeSettings = Effect.gen(function* () {
  const { env, cwd } = yield* CliEnv
  const projectRoot = repoRootFor(cwd)
  return { projectRoot, paths: settingsPaths({ projectRoot: projectRoot ?? cwd, home: env.HOME }) }
})

/** Reads a settings file, changes it with `change`, and replaces it atomically (old bytes in .bak) if anything changed. */
const updateSettings = (file: string, change: (settings: unknown) => Merged) =>
  Effect.gen(function* () {
    const refused = (e: unknown) => new CliFailure({ message: `Can't update ${file}: ${(e as Error).message}. Fix it first; Cello won't overwrite it.` })
    const current = yield* Effect.try({ try: () => readSettingsFile(file), catch: refused })
    const merged = yield* Effect.try({ try: () => change(current.settings), catch: refused })
    if (!merged.changed) return { changed: false, backup: null }
    const written = yield* Effect.try({
      try: () => writeFileAtomically(file, formatSettings(merged.settings, current.format)),
      catch: (e) => new CliFailure({ message: `Can't write ${file}: ${(e as Error).message}.` }),
    })
    return { changed: true, backup: written.backup }
  })

/** What git runs with when it checks ignores: HOME (and XDG_CONFIG_HOME) decide the user's global excludes. */
const gitEnv = (env: Env) =>
  Object.fromEntries(Object.entries({ PATH: process.env.PATH, HOME: env.HOME, XDG_CONFIG_HOME: env.XDG_CONFIG_HOME }).filter(([, v]) => v !== undefined))

/**
 * `cello install claude`'s work, also run by `cello init --hooks`: Cello's hooks merged into the
 * scope's settings file and, for this machine's file, git told to ignore it. Returns what it did and
 * the lines that say so.
 */
const installHooks = (scope: keyof typeof SCOPES) =>
  Effect.gen(function* () {
    const { env } = yield* CliEnv
    const { projectRoot, paths } = yield* claudeSettings
    const file = paths[scope]
    if (file === null) return yield* new CliFailure({ message: "HOME isn't set, so there's no ~/.claude/settings.json to write." })
    // The artifact guard is for Cello projects, so the user's settings (every project) don't get it.
    const wanted = celloHooksFor(scope === "user" ? "user" : "project")
    const { changed, backup } = yield* updateSettings(file, (settings) => addCelloHooks(settings, wanted))
    const ignored = scope === "local" && projectRoot !== null ? ensureGitIgnored(projectRoot, ".claude/settings.local.json", gitEnv(env)) : null
    const ignoredLine = ignored ? [`Added .claude/settings.local.json to ${ignored}, so it stays on this machine.`] : []
    if (!changed) return { file, changed, lines: [`Cello's Claude Code hooks are already in ${file}.`, ...ignoredLine] }
    const lines = [
      `Installed Cello's Claude Code hooks in ${file} (${SCOPES[scope]}):`,
      ...indent(columns(wanted.map((h) => [h.event, h.command]))),
      ...ignoredLine,
      ...(backup ? [`Kept the old file as ${backup}.`] : []),
      "Your comments and Send back notes on a task an agent session claimed now reach that session: when it stops, and after each tool call.",
      ...(wanted.some((h) => h.projectOnly)
        ? [
          "Agents here can't publish Claude artifacts: they're told to publish a Cello page instead. " +
          `Start Claude Code with ${ALLOW_ARTIFACTS_VARIABLE}=1 when you want one.`,
        ]
        : []),
      "New Claude Code sessions pick them up.",
    ]
    if (Bun.which("cello", { PATH: env.PATH ?? "" }) === null) {
      lines.push(
        "`cello` isn't on your PATH, so Claude Code can't run the hooks. Put the cello binary on the PATH Claude Code starts with (e.g. ~/.local/bin).",
      )
    }
    return { file, changed, lines }
  })

const installClaude = Command.make("claude", {
  user: Flag.Boolean("user").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Write ~/.claude/settings.json instead: every project on this machine."),
  ),
  shared: Flag.Boolean("shared").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Write this project's .claude/settings.json instead, committed with the repo: everyone who clones it gets the hooks and needs cello."),
  ),
}, (input) =>
  Effect.gen(function* () {
    if (input.user && input.shared) {
      return yield* new CliFailure({
        message: "Pick one: --user (every project) or --shared (this project, committed). Without either it's this project on this machine.",
      })
    }
    const { lines } = yield* installHooks(input.user ? "user" : input.shared ? "shared" : "local")
    yield* print(lines.join("\n"))
  })).pipe(Command.withDescription(
    "Add Claude Code hooks that deliver new comments into the agent session holding the task (Stop and PostToolUse), and one that " +
      "turns Claude artifact publishes away in favour of Cello pages (PreToolUse on Artifact; not with --user), all running " +
      "`cello hook claude`. Writes this project's .claude/settings.local.json (this machine, git-ignored; from a worktree, the main " +
      "checkout's), merged with the hooks already there; running it again changes nothing. The old file is kept as .bak.",
  ))

const uninstallClaude = Command.make("claude", {}, () =>
  Effect.gen(function* () {
    const { paths } = yield* claudeSettings
    const files = [...new Set([paths.local, paths.shared, paths.user].filter((f): f is string => f !== null))]
    const removed: string[] = []
    for (const file of files) if ((yield* updateSettings(file, removeCelloHooks)).changed) removed.push(file)
    if (removed.length) return yield* print(removed.map((f) => `Removed Cello's Claude Code hooks from ${f}.`).join("\n"))
    yield* print(`No Cello hooks in ${files.slice(0, -1).join(", ")}${files.length > 1 ? " or " : ""}${files.at(-1)}.`)
  })).pipe(Command.withDescription(
    "Take Cello's hooks out of Claude Code's settings: this project's .claude/settings.local.json and .claude/settings.json, and " +
      "~/.claude/settings.json. Every other hook and setting stays as it was.",
  ))

// ── setting up a repo (CEL-41) ──────────────────────────────────────────────────────────────────

/** Where the board shows a project: the web app `cello start` serves on the same port. */
const boardUrl = (env: Env, projectKey: string) => `http://127.0.0.1:${portOf(env)}/${projectKey}`

const init = Command.make("init", {
  name: Flag.String("name").pipe(Flag.optional, Flag.withDescription("The project's name. Default: the repository's folder name.")),
  key: Flag.String("key").pipe(
    Flag.optional,
    Flag.withDescription("Its task key: 2 to 10 letters or digits, starting with a letter (THAI gives THAI-1, THAI-2…). Default: one made from the name that no project has."),
  ),
  workspace: Flag.String("workspace").pipe(Flag.optional, Flag.withDescription("The workspace to put it in, by name. Default: the first one.")),
  hooks: Flag.Boolean("hooks").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Also install the Claude Code hooks for this machine, as `cello install claude` does."),
  ),
  agentsMd: Flag.Boolean("agents-md").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Also add the \"Tracking work in Cello\" section to this checkout's AGENTS.md (CLAUDE.md when there's no AGENTS.md), once."),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Print JSON: created, project, url, hooks and agentsMd ({ file, changed }, or null when not asked for or not reached), and error when --hooks or --agents-md failed."),
  ),
}, (input) =>
  Effect.gen(function* () {
    const { cwd, env } = yield* CliEnv
    const repoPath = repoRootFor(cwd)
    const checkout = checkoutRootFor(cwd)
    if (repoPath === null || checkout === null) {
      return yield* new CliFailure({
        message: "This folder isn't in a git repository. Run `cello init` inside the repo you want to track (`git init` first for a new one).",
      })
    }
    const { project, created } = yield* withClient((client) =>
      Effect.gen(function* () {
        const linkedProject = Effect.map(client["whoami"]({ project: { repoPath } }), (w) => w.project)
        const linked = yield* linkedProject
        if (linked) return { project: linked, created: false }
        const { workspaces } = yield* client["snapshot.get"]({})
        const workspace = Option.isSome(input.workspace) ? yield* byName("workspace", workspaces, input.workspace.value) : workspaces[0]!
        return yield* client["project.create"]({
          commandId: newCommandId(),
          workspaceId: workspace.id,
          name: Option.getOrElse(input.name, () => path.basename(repoPath)),
          repoPath,
          ...(Option.isSome(input.key) ? { key: input.key.value } : {}),
        }).pipe(
          Effect.map((written) => ({ project: written.result, created: true })),
          Effect.catchTag("Invalid", (e) =>
            Effect.gen(function* () {
              if (e.field === "key") {
                return yield* new CliFailure({ message: `--key ${Option.getOrElse(input.key, () => "")} won't do: a key ${e.reason}.` })
              }
              if (e.field !== "repoPath") return yield* e
              // Another `cello init` may have linked it a moment ago; otherwise an archived project holds the path.
              const now = yield* linkedProject
              if (now) return { project: now, created: false }
              return yield* new CliFailure({ message: `${repoPath} is ${e.reason}, so it can't be linked again. Ask Lucas what to do with it.` })
            })),
        )
      })
    )
    const url = boardUrl(env, project.key)
    const ignored = (["key", "name", "workspace"] as const).filter((flag) => Option.isSome(input[flag])).map((flag) => `--${flag}`)
    // Said first, so a failing --hooks or --agents-md still leaves the project's state on screen.
    if (!input.json) {
      yield* print([
        created
          ? `Created project ${project.key} · ${project.name} for ${repoPath} (tasks ${project.key}-1, ${project.key}-2, …)`
          : `This repo is already project ${project.key} · ${project.name} (${project.repoPath ?? repoPath}); the project itself is unchanged.` +
            (ignored.length ? ` ${andList(ignored)} only ${ignored.length === 1 ? "applies" : "apply"} to a new project.` : ""),
        url,
      ].join("\n"))
    }
    // The rest of the setup. What it did is kept even when a later step fails, so it can be reported.
    const done: {
      hooks: Effect.Success<ReturnType<typeof installHooks>> | null
      agentsMd: ReturnType<typeof addAgentsSection> | null
    } = { hooks: null, agentsMd: null }
    const failure = yield* Effect.gen(function* () {
      if (input.hooks) done.hooks = yield* installHooks("local")
      if (input.agentsMd) {
        done.agentsMd = yield* Effect.try({
          try: () => addAgentsSection(checkout, GUIDE, project.key),
          catch: (e) => new CliFailure({ message: `Can't add the Cello section to ${agentsFile(checkout)}: ${(e as Error).message}.` }),
        })
      }
    }).pipe(
      Effect.as(null),
      Effect.catch((e) => Effect.succeed(new CliFailure({ message: `Project ${project.key} is set up, but the next step failed: ${e.message}` }))),
    )
    const { hooks, agentsMd } = done
    if (input.json) {
      yield* printJson({
        created,
        project,
        url,
        hooks: hooks && { file: hooks.file, changed: hooks.changed },
        agentsMd,
        ...(failure ? { error: failure.message } : {}),
      })
    } else {
      const lines = [
        ...(hooks?.lines ?? []),
        ...(agentsMd === null
          ? []
          : agentsMd.changed
          ? [`Added the "Tracking work in Cello" section to ${agentsMd.file} (uncommitted).`]
          : [`${agentsMd.file} already has a "Tracking work in Cello" section; left it as it is.`]),
      ]
      if (lines.length) yield* print(lines.join("\n"))
    }
    if (failure) return yield* failure
  })).pipe(Command.withDescription(
    "Make the git repository you're in a Cello project: creates it with this repo's path (the main checkout's, from a worktree), " +
      "named after the folder, with a free key made from the name, and prints its key and board URL. In a repo that's already a " +
      "project it says which one and changes nothing. --hooks and --agents-md do the rest of the setup; each is safe to run again.",
  ))

const install = Command.make("install").pipe(
  Command.withDescription("Connect an agent host to Cello: `cello install claude` adds the Claude Code hooks."),
  Command.withSubcommands([installClaude]),
)

const uninstall = Command.make("uninstall").pipe(
  Command.withDescription("Undo `cello install`: `cello uninstall claude` removes the Claude Code hooks."),
  Command.withSubcommands([uninstallClaude]),
)

const guide = Command.make("guide", {}, () => print(GUIDE)).pipe(
  Command.withDescription("Print the full guide for agents: concepts, workflow, examples, errors and every command (docs/cli.md)."),
)

const task = Command.make("task").pipe(
  Command.withDescription("Tasks: list, get, create, claim, release, stage, move, comment, submit, ask, answers."),
  Command.withSubcommands([list, get, create, claim, release, stage, move, comment, submit, ask, answers]),
)

const startCommand = Command.make("start", {}, () => start).pipe(
  Command.withDescription("Run the Cello server on 127.0.0.1:4747 with data in ~/.cello (CELLO_PORT, CELLO_DATA_DIR), serving its built-in web app, or every file in CELLO_WEB_DIR when that folder has an index.html."),
)

export const cello = Command.make("cello").pipe(
  Command.withDescription("A local task board for you and your coding agents."),
  Command.withSubcommands([context, init, task, waitCommand, inbox, doc, whoami, guide, install, uninstall, hook, startCommand, backup, restoreCommand, buildsCommand]),
)

/**
 * Runs `cello` with these arguments (without the program name). A defect (a failing disk, a bug)
 * still ends in one printed sentence instead of a silent exit.
 */
export const run = (args: ReadonlyArray<string>) =>
  Effect.flatMap(Effect.service(CliEnv), ({ build }) => Command.runWith(cello, { version: versionText(build) })(args)).pipe(
    Effect.provideService(CliArgs, args),
    Effect.catchDefect((defect) => Effect.fail(new CliFailure({ message: `Something went wrong: ${reasonOf(defect)}` }))),
  )
