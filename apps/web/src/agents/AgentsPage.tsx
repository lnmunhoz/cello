import { currentStepOf } from "@cello/client/sync/agentLog"
import { finishedAgents, startOfDay } from "@cello/client/sync/agents"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { stageInfo } from "@cello/contract/stages"
import { isNeedsInputStatus } from "@cello/shared/ask"
import { modelName } from "@cello/shared/model"
import { originText } from "@cello/shared/origin"
import { agoShort, presenceWords } from "@cello/shared/presence"
import { isRunning } from "@cello/shared/testRun"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { FolderIcon, HourglassIcon } from "lucide-react"
import { AnimatePresence, LayoutGroup, MotionConfig, motion, usePresence } from "motion/react"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { CardBody } from "../board/Card.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { Author } from "../presence/Author.tsx"
import { OriginBadge } from "../presence/OriginBadge.tsx"
import { agentsWorkingCount, workingSessions } from "../presence/model.ts"
import { AgentMarkOf, presenceSubjectOf, StageWord } from "../presence/Presence.tsx"
import { TestRunFacts, TestRunLine, testRunOf } from "../presence/TestRun.tsx"
import { useNow } from "../presence/useNow.ts"
import { QueueRow, type QueueRowState } from "../review/QueueRow.tsx"
import { useQueue } from "../review/useQueue.ts"
import { TaskLink } from "../task/TaskKey.tsx"
import { keepViewer } from "../viewer/search.ts"
import { AgentLog } from "./AgentLog.tsx"
import {
  type AgentRow,
  agentGroups,
  agentRows,
  directTasks,
  finishedRows,
  groupOf,
  pulseKeyOf,
  rowKeysOf,
  stateTaskOf,
  subagentsLabel,
  waitingTaskOf,
} from "./layout.ts"

/**
 * The Agents page (CEL-65), opened from the sidebar's "Agents working": every agent session and subagent
 * working in the workspace, with the card each is on, laid out like the Review page. Agents waiting on
 * the human come first, then the ones working, then the quiet ones; subagents sit under their session. One
 * row is open at a time (`?open=`): what the agent was asked and its card on the left, and on the right
 * its live log (CEL-106, AgentLog.tsx). Rows keep their place, in the order the agents started (CEL-186):
 * a call an agent makes pulses its row once; a row animates when it changes group (an agent starts, waits,
 * goes quiet or finishes) or leaves, and nothing animates while nothing happens (spike-board-ui point 6);
 * the ones that finished today fold into "Finished today" at the bottom, newest first, their logs still
 * a click away while Claude Code keeps the transcript (CEL-107).
 */
/** How a row moves to its new group, or out (CEL-186): the board's spring. */
// CEL-189: replace with lib/motion.ts tokens at integration
const layoutTransition = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const

/**
 * How a row leaves its group: one that left the page fades out; one that moved to another group (still in
 * `keys`, AnimatePresence's custom) leaves its old place at once, while its copy there slides in.
 */
const exitOf = (id: string) => ({
  gone: (keys: ReadonlyArray<string> | undefined) => ({ opacity: 0, transition: { duration: keys?.includes(id) ? 0 : 0.15 } }),
})

export function AgentsPage() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  return <Agents board={board} workspaceId={workspaceId} />
}

function Agents({ board, workspaceId }: { board: BoardState; workspaceId: string }) {
  const { open } = useSearch({ from: "/agents" })
  const navigate = useNavigate({ from: "/agents" })
  const now = useNow()
  const sessions = workingSessions(board, workspaceId, now)
  const rows = agentRows(sessions)
  const finished = finishedRows(board, finishedAgents(board, workspaceId, startOfDay(now)))
  const groups = agentGroups(rows, finished)
  const keys = rowKeysOf(groups)
  const layoutKey = groups.map((g) => `${g.id}:${g.rows.map((r) => r.id).join(",")}`).join(";")
  const openId = open !== undefined && keys.includes(open) ? open : null
  const queue = useQueue({ keys, open: openId, setOpen: (id) => void navigate({ search: (prev) => ({ ...keepViewer(prev), ...(id === null ? {} : { open: id }) }), replace: true }) })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Agents working" }]} />
      {/* A packet container, like the Review page's: on a wide panel an open row splits in two. */}
      <div data-agents-scroller="" className="@container/packet flex-1 overflow-y-auto py-6">
        <div className="packet-column flex flex-col gap-6">
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold">
              Agents working <span className="font-normal text-muted tabular-nums">{agentsWorkingCount(sessions)}</span>
            </h1>
            <p className="text-[13px] text-muted">
              Every agent session and subagent on a task in this workspace, and the card it's on. Agents waiting on you come first, the ones
              that finished today last. Open one to see what it was asked and its log. ↑ ↓ or j k move between rows, Enter opens, Esc closes.
            </p>
          </header>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
              <p className="text-[15px] font-medium text-ink">No agent is working</p>
              <p>When an agent claims a task, or a subagent starts on one, it shows up here.</p>
            </div>
          ) : null}
          {groups.length === 0 ? null : (
            <MotionConfig reducedMotion="user">
              <PageRows.Provider value={keys}>
              <LayoutGroup>
            <div {...queue.list} className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`agents-${group.id}`} data-agents-group={group.id} className="flex flex-col gap-2">
                  <h2 id={`agents-${group.id}`} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    {group.id === "waiting" ? <i aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                    {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
                  </h2>
                  <ul aria-label={group.label} className="flex flex-col gap-2">
                    {/* custom: the rows on the page now, so a row that left this group for another goes at once (the copy there slides in). */}
                    <AnimatePresence initial={false} custom={keys}>
                      {group.rows.map((row) => {
                        // A subagent sits under its session, always in the same group (CEL-104); finished ones stand on their own.
                        const under = row.kind === "agent" && group.id !== "finished"
                        return (
                          // layoutId: a row that changes group slides there from where it was, instead of jumping (CEL-186).
                          // layoutDependency: only a change of rows animates, not a row opening above it.
                          <motion.li
                            key={row.id}
                            layoutId={row.id}
                            layout="position"
                            layoutDependency={layoutKey}
                            transition={layoutTransition}
                            custom={keys}
                            variants={exitOf(row.id)}
                            exit="gone"
                            className={under ? "relative pl-6" : "relative"}
                          >
                            <Leaving id={row.id}>
                              <AgentQueueRow {...queue.row(row.id)} board={board} row={row} rows={rows} />
                              <Pulse at={pulseKeyOf(row)} under={under} />
                            </Leaving>
                          </motion.li>
                        )
                      })}
                    </AnimatePresence>
                  </ul>
                </section>
              ))}
            </div>
              </LayoutGroup>
              </PageRows.Provider>
            </MotionConfig>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A row's content while AnimatePresence lets it go. One that moved to another group (its id still on the
 * page: the copy there slides in from here, layoutId) is gone at once, so the page never shows it twice;
 * one that left the page stays while it fades. The rows come from context: an exiting row keeps its last props.
 */
function Leaving({ id, children }: { id: string; children: ReactNode }) {
  const [present, safeToRemove] = usePresence()
  const onPage = useContext(PageRows)
  const moved = !present && onPage.includes(id)
  useEffect(() => {
    if (moved) safeToRemove?.()
  }, [moved, safeToRemove])
  return moved ? null : children
}

/** The rows on the page now, for an exiting row (whose props are stale) to tell a move from a leave. */
const PageRows = createContext<ReadonlyArray<string>>([])

/**
 * One short pulse over a row each time the board hears its agent check in (CEL-186; at most once a minute
 * while it makes calls, PRESENCE_EVERY_MS, the same beat as its card's burst): what used to move the row
 * to the top now shows where it is. None for the check-in it had when the page opened; it ends invisible,
 * so an idle page runs no animation.
 */
function Pulse({ at, under }: { at: number; under: boolean }) {
  const [first] = useState(at)
  if (at === first) return null
  return (
    <motion.span
      key={at}
      aria-hidden
      data-agent-pulse=""
      className={under ? "pointer-events-none absolute inset-y-0 right-0 left-6 rounded-lg bg-accent/10" : "pointer-events-none absolute inset-0 rounded-lg bg-accent/10"}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    />
  )
}

const PRESENCE_TEXT = { active: "text-ink", idle: "text-idle", ended: "text-faint" } as const

/** "active now" / "seen 12m ago" / "finished 3m ago", in the presence's colour. */
function PresenceText({ board, row }: { board: BoardState; row: AgentRow }) {
  const now = useNow()
  return (
    <span
      className={`shrink-0 ${PRESENCE_TEXT[row.presence]}`}
      data-agent-presence
      title={row.endedAt === null ? undefined : new Date(row.endedAt).toLocaleTimeString()}
    >
      {row.endedAt === null ? presenceWords(presenceSubjectOf(board, row.session, row.agent), now) : `finished ${agoShort(row.endedAt, now)}`}
    </span>
  )
}

/**
 * One agent: collapsed, its mark in its card's mood, who it is (and which session it's under), its
 * presence and the task it's on, the task's stage on the right; open, what it was asked and the card
 * on the left, and where its live log goes on the right.
 */
function AgentQueueRow({ board, row, rows, ...state }: QueueRowState & { board: BoardState; row: AgentRow; rows: ReadonlyArray<AgentRow> }) {
  const first = row.tasks[0]
  const waitingOn = groupOf(row) === "waiting" ? waitingTaskOf(row, board.statuses) : undefined
  const slug = row.id.replace(/[^a-zA-Z0-9-]/g, "-")
  return (
    <QueueRow
      {...state}
      headingId={`agent-${slug}`}
      bodyId={`agent-body-${slug}`}
      data={{ "data-agent-row": row.id, "data-agent-group": groupOf(row) }}
      lead={
        <span className="flex size-5 shrink-0 items-center justify-center">
          <AgentMarkOf board={board} session={row.session} agent={row.agent} who={row.who} look={row.mark} size={18} place="agents" />
        </span>
      }
      title={
        <>
          {/* The main session or a subagent of it, and the model and effort it's on now (CEL-119). */}
          <Author who={row.who} name={row.kind === "agent" ? row.who.name : undefined} />
          {row.kind === "session" && row.subagents > 0 ? <span className="shrink-0 text-muted">· {subagentsLabel(row.subagents)}</span> : null}
          {/* Where the session runs (CEL-137): Terminal, Claude desktop, Woken by Cello. */}
          {row.kind === "session" ? <OriginBadge session={row.session} /> : null}
        </>
      }
      subtitle={
        <>
          <PresenceText board={board} row={row} />
          {first ? (
            <>
              <span className="text-faint">·</span>
              <i aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: board.projects[first.projectId]?.color }} />
              <span className="truncate">
                {row.kind === "session" ? "holds " : "on "}
                <span className="tabular-nums">{row.tasks.map((t) => t.key).join(", ")}</span>
                {row.tasks.length === 1 ? ` ${first.title}` : ""}
              </span>
            </>
          ) : null}
          <CurrentStep row={row} />
        </>
      }
      badge={<TaskState board={board} task={stateTaskOf(row, board.statuses)} />}
    >
      <div className="grid gap-5 packet-wide:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {waitingOn ? (
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink" data-agent-waiting>
              Waiting for your answer on {waitingOn.key}.
              <Link
                to="/review"
                search={{ open: waitingOn.key }}
                className="rounded-sm text-[13px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                Answer on Review
              </Link>
            </p>
          ) : null}
          <Facts board={board} row={row} />
          {row.tasks.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted">{row.kind === "session" ? "Holds" : "Working on"}</h3>
              {(row.kind === "session" ? row.tasks : directTasks(row, rows)).map((t) => <TaskCard key={t.id} board={board} task={t} />)}
            </div>
          ) : null}
        </div>
        <AgentLog board={board} row={row} />
      </div>
    </QueueRow>
  )
}

/**
 * A task as its board card shows it, a click away from the task. No work line: the row above it already
 * names the agent and its presence. The card is a container whose title is the link, stretched over the
 * whole card, so a click anywhere opens the task while its evidence badge stays a control of its own (a
 * button can't sit inside a link). Positioned, so the stretched link and the edge of an agent at work
 * on it (CEL-76) sit on this card.
 */
function TaskCard({ board, task }: { board: BoardState; task: Task }) {
  const project = board.projects[task.projectId]
  if (!project) return null
  return (
    <div
      data-agents-card={task.key}
      className="relative flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-left shadow-card hover:border-line-strong has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring"
    >
      <CardBody
        task={task}
        board={board}
        work={false}
        titleLink={(title) => (
          // In this page's side panel (CEL-141); ⌘-click opens it on its board in a new tab. The card is
          // the task in view, so no hover card about it (CEL-142).
          <TaskLink taskKey={task.key} preview={false} className="outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']">
            {title}
          </TaskLink>
        )}
      />
    </div>
  )
}

/** Where a row's task stands, for the collapsed row's right side: Needs input first, else its stage, else its status. */
function TaskState({ board, task }: { board: BoardState; task: Task | undefined }) {
  if (!task) return <span className="shrink-0 text-xs text-faint">No task</span>
  const status = board.statuses[task.statusId]
  // A task waiting on Lucas keeps its stage (Agent review, say), but waiting is what matters now.
  const stage = task.stage === null || (status && isNeedsInputStatus(status)) ? undefined : stageInfo(task.stage)
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs" data-agent-task-state>
      {stage ? (
        <StageWord stage={stage} />
      ) : status ? (
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <StatusIcon category={status.category} color={status.color} />
          {status.name}
        </span>
      ) : null}
    </span>
  )
}

/** What the agent was asked (a subagent's launch description), its session, where it runs, when it started, its last check-in, its folder. */
function Facts({ board, row }: { board: BoardState; row: AgentRow }) {
  const now = useNow()
  const started = row.agent?.startedAt ?? row.session.startedAt
  const folder = row.session.cwd?.split("/").filter(Boolean).at(-1)
  const run = testRunOf(row.session, row.agent)
  // Where its session runs, and when Cello last woke it (CEL-137).
  const origin = originText(row.session, now)
  const fact = "grid grid-cols-[96px_1fr] gap-2 text-[13px]"
  return (
    <dl className="flex flex-col gap-1.5" data-agent-facts>
      {row.agent?.description ? (
        <div className={fact}>
          <dt className="text-muted">Asked to</dt>
          <dd className="text-ink">{row.agent.description}</dd>
        </div>
      ) : null}
      <div className={fact}>
        <dt className="text-muted">Session</dt>
        <dd className="text-ink">{row.kind === "agent" ? (row.who.parent ?? row.session.clientName) : row.who.name}</dd>
      </div>
      {row.who.model ? (
        <div className={fact} data-agent-model>
          <dt className="text-muted">Model</dt>
          <dd className="text-ink">
            {modelName(row.who.model)}
            {row.who.effort ? <span className="text-muted"> · {row.who.effort} effort</span> : null}
          </dd>
        </div>
      ) : null}
      {origin ? (
        <div className={fact} data-agent-origin>
          <dt className="text-muted">Runs in</dt>
          <dd className="text-ink">{origin}</dd>
        </div>
      ) : null}
      <div className={fact}>
        <dt className="text-muted">Started</dt>
        <dd className="text-ink">{agoShort(started, now)}</dd>
      </div>
      {run ? (
        <div className={fact}>
          <dt className="text-muted">Tests</dt>
          <TestRunFacts run={run} />
        </div>
      ) : null}
      <div className={fact}>
        <dt className="text-muted">Checked in</dt>
        <dd>
          <PresenceText board={board} row={row} />
        </dd>
      </div>
      {folder ? (
        <div className={fact}>
          <dt className="text-muted">Folder</dt>
          <dd className="flex min-w-0 items-center gap-1.5 text-ink">
            <FolderIcon aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="truncate" title={row.session.cwd ?? undefined}>
              {folder}
            </span>
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

/**
 * What it's doing right now, from its last tool call ("Bash · bun run test"), while it's working (CEL-106);
 * a subagent that ended its turn while its own background work runs, what it waits on (CEL-133).
 */
function CurrentStep({ row }: { row: AgentRow }) {
  const now = useNow()
  // Running tests (CEL-134) says the most: where the run is.
  const run = row.presence === "ended" ? null : testRunOf(row.session, row.agent)
  if (run !== null && isRunning(run, now)) return <TestRunLine run={run} />
  const waitingOn = row.presence === "ended" ? null : row.agent?.waitingOn
  if (waitingOn) {
    return (
      <>
        <span className="text-faint">·</span>
        <span className="flex min-w-0 items-center gap-1 text-muted" data-agent-waiting-on title={waitingOn.join("\n")}>
          <HourglassIcon aria-hidden className="size-3 shrink-0" />
          <span className="shrink-0">Waiting on background work</span>
          <span className="min-w-0 truncate font-mono text-[12px]">{waitingOn.join(", ")}</span>
        </span>
      </>
    )
  }
  const step = currentStepOf(row)
  if (!step) return null
  return (
    <>
      <span className="text-faint">·</span>
      <span className="min-w-0 truncate font-mono text-[12px] text-muted" data-agent-step>
        {step}
      </span>
    </>
  )
}
