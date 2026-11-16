import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { stageInfo } from "@cello/contract/stages"
import { isNeedsInputStatus } from "@cello/shared/ask"
import { agoShort, presenceWords } from "@cello/shared/presence"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { FolderIcon, ScrollTextIcon } from "lucide-react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { CardBody } from "../board/Card.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { agentsWorkingCount, workingSessions } from "../presence/model.ts"
import { AgentMarkOf, presenceSubjectOf, StageWord } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"
import { QueueRow, type QueueRowState } from "../review/QueueRow.tsx"
import { useQueue } from "../review/useQueue.ts"
import { keepViewer } from "../viewer/search.ts"
import { type AgentRow, agentGroups, agentRows, directTasks, groupOf, rowKeysOf, stateTaskOf, subagentsLabel, waitingTaskOf } from "./layout.ts"

/**
 * The Agents page (CEL-65), opened from the sidebar's "Agents working": every agent session and subagent
 * working in the workspace, with the card each is on, laid out like the Review page. Agents waiting on
 * Lucas come first, then the ones working, then the quiet ones; subagents sit under their session. One
 * row is open at a time (`?open=`): what the agent was asked and its card on the left, and on the right
 * its live log, which is phase 2. Rows come, move and go live, as agents start, wait, go quiet and finish.
 */
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
  const groups = agentGroups(rows)
  const keys = rowKeysOf(groups)
  const openId = open !== undefined && keys.includes(open) ? open : null
  const queue = useQueue({ keys, open: openId, setOpen: (id) => void navigate({ search: (prev) => ({ ...keepViewer(prev), ...(id === null ? {} : { open: id }) }), replace: true }) })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Agents working" }]} />
      {/* A packet container, like the Review page's: on a wide panel an open row splits in two. */}
      <div data-agents-scroller="" className="@container/packet flex-1 overflow-y-auto py-6">
        <div className="mx-auto box-content flex max-w-3xl flex-col gap-6 px-8 packet-wide:max-w-[1536px]">
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold">
              Agents working <span className="font-normal text-muted tabular-nums">{agentsWorkingCount(sessions)}</span>
            </h1>
            <p className="text-[13px] text-muted">
              Every agent session and subagent on a task in this workspace, and the card it's on. Agents waiting on you come first. Open one
              to see what it was asked. ↑ ↓ or j k move between rows, Enter opens, Esc closes.
            </p>
          </header>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
              <p className="text-[15px] font-medium text-ink">No agent is working</p>
              <p>When an agent claims a task, or a subagent starts on one, it shows up here.</p>
            </div>
          ) : (
            <div {...queue.list} className="flex flex-col gap-6">
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`agents-${group.id}`} data-agents-group={group.id} className="flex flex-col gap-2">
                  <h2 id={`agents-${group.id}`} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    {group.id === "waiting" ? <i aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                    {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
                  </h2>
                  <ul aria-label={group.label} className="flex flex-col gap-2">
                    {group.rows.map((row) => (
                      // A subagent sits under its session, always in the same group (CEL-104).
                      <li key={row.id} className={row.kind === "agent" ? "pl-6" : undefined}>
                        <AgentQueueRow {...queue.row(row.id)} board={board} row={row} rows={rows} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PRESENCE_TEXT = { active: "text-ink", idle: "text-idle", ended: "text-faint" } as const

/** "active now" / "seen 12m ago", in the presence's colour. */
function PresenceText({ board, row }: { board: BoardState; row: AgentRow }) {
  const now = useNow()
  return (
    <span className={`shrink-0 ${PRESENCE_TEXT[row.presence]}`} data-agent-presence>
      {presenceWords(presenceSubjectOf(board, row.session, row.agent), now)}
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
          <span className="truncate font-semibold text-ink">{row.kind === "agent" ? row.who.name : row.who.short}</span>
          {row.kind === "session" ? (
            <span className="shrink-0 text-muted">{row.role === "orchestrator" ? `orchestrator · ${subagentsLabel(row.subagents)}` : "session"}</span>
          ) : row.who.parentShort ? (
            <span className="shrink-0 text-faint">under {row.who.parentShort}</span>
          ) : null}
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
        <LogPlaceholder />
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
          <Link
            to="/$projectKey/$number"
            params={{ projectKey: project.key, number: String(task.number) }}
            className="outline-none after:absolute after:inset-0 after:rounded-lg after:content-['']"
          >
            {title}
          </Link>
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

/** What the agent was asked (a subagent's launch description), its session, when it started, its last check-in, its folder. */
function Facts({ board, row }: { board: BoardState; row: AgentRow }) {
  const now = useNow()
  const started = row.agent?.startedAt ?? row.session.startedAt
  const folder = row.session.cwd?.split("/").filter(Boolean).at(-1)
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
      <div className={fact}>
        <dt className="text-muted">Started</dt>
        <dd className="text-ink">{agoShort(started, now)}</dd>
      </div>
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

/** Where the agent's live log goes (phase 2): a quiet placeholder, never made-up steps. */
function LogPlaceholder() {
  return (
    <section
      aria-label="Live log, coming in phase 2"
      data-log-placeholder
      className="flex min-h-40 flex-col gap-2 rounded-lg border border-dashed border-line px-4 py-3"
    >
      <header className="flex items-center gap-2 text-[13px]">
        <ScrollTextIcon aria-hidden className="size-3.5 text-faint" />
        <span className="font-medium text-muted">Live log</span>
        <span className="text-xs text-faint">coming in phase 2</span>
      </header>
      <p className="text-xs text-faint">
        What this agent says and each tool it calls, with the result, newest at the bottom, following new steps as they arrive.
      </p>
    </section>
  )
}
