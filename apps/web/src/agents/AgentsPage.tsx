import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { stageInfo } from "@cello/contract/stages"
import { agoShort, presenceWords } from "@cello/shared/presence"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronRightIcon, FolderIcon, ScrollTextIcon } from "lucide-react"
import { useEffect } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { CardBody } from "../board/Card.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { agentsWorkingCount, workingSessions } from "../presence/model.ts"
import { AgentMarkOf, presenceSubjectOf, StageWord } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"
import { type AgentRow, type AgentsLayout, agentGroups, agentRows, directTasks, groupOf } from "./layout.ts"
import { rememberAgentsPrototype } from "./prototype.ts"

/**
 * The Agents page (CEL-65, phase 1), opened from the sidebar's "Agents working": every agent session
 * and subagent working in the workspace, with the cards they're on. A design prototype for now: three
 * layouts behind `?agents=a|b|c` while Lucas picks one. The live log of each agent is phase 2; each
 * layout shows where it will go.
 */
export function AgentsPage() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  return <Agents board={board} workspaceId={workspaceId} />
}

const LAYOUT_NAMES: Record<AgentsLayout, string> = { a: "A · Rows", b: "B · By session", c: "C · Cards" }

function Agents({ board, workspaceId }: { board: BoardState; workspaceId: string }) {
  const { agents: picked, open } = useSearch({ from: "/agents" })
  const layout = picked ?? "a"
  const navigate = useNavigate({ from: "/agents" })
  const now = useNow()
  const sessions = workingSessions(board, workspaceId, now)
  const rows = agentRows(sessions)
  const count = agentsWorkingCount(sessions)
  const openId = open !== undefined && rows.some((r) => r.id === open) ? open : null
  const setOpen = (id: string | null) => void navigate({ search: { agents: layout, ...(id === null ? {} : { open: id }) }, replace: true })

  // Visiting with ?agents= turns the sidebar's link to this page on, on this device (the prototype switch).
  useEffect(() => {
    if (picked) rememberAgentsPrototype(picked)
  }, [picked])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Agents working" }]} />
      <div data-agents-scroller="" className="@container/packet flex-1 overflow-y-auto py-6">
        <div className={`mx-auto box-content flex flex-col gap-6 px-8 ${layout === "c" ? "max-w-[1180px]" : "max-w-3xl packet-wide:max-w-[1536px]"}`}>
          <header className="flex items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h1 className="text-[17px] font-semibold">
                Agents working <span className="font-normal text-muted tabular-nums">{count}</span>
              </h1>
              <p className="text-[13px] text-muted">
                Every agent session and subagent on a task in this workspace, and the card it's on. Agents waiting on you come first.
                Open one to see what it was asked; its live log comes next (phase 2).
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1" data-agents-switch>
              <span className="text-[11px] font-medium text-faint">Prototype layout</span>
              <SegmentedControl
                size="sm"
                aria-label="Prototype layout"
                value={layout}
                onValueChange={(value) => value && void navigate({ search: { agents: value as AgentsLayout }, replace: true })}
              >
                {(["a", "b", "c"] as const).map((l) => (
                  <SegmentedControlItem key={l} value={l}>
                    {LAYOUT_NAMES[l]}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
          </header>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
              <p className="text-[15px] font-medium text-ink">No agent is working</p>
              <p>When an agent claims a task, or a subagent starts on one, it shows up here.</p>
            </div>
          ) : layout === "a" ? (
            <RowsLayout board={board} rows={rows} openId={openId} onToggle={(id) => setOpen(openId === id ? null : id)} />
          ) : layout === "b" ? (
            <SessionsLayout board={board} rows={rows} openId={openId} onToggle={(id) => setOpen(openId === id ? null : id)} />
          ) : (
            <CardsLayout board={board} rows={rows} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── shared pieces ────────────────────────────────────────────────────────────────────────────────

/** The row's agent mark, in the mood its card shows, burst once per check-in (CEL-69). */
function Mark({ board, row, size, place }: { board: BoardState; row: AgentRow; size: number; place: string }) {
  return <AgentMarkOf board={board} session={row.session} agent={row.agent} who={row.who} look={row.mark} size={size} place={`agents-${place}`} />
}

const PRESENCE_TEXT = { active: "text-ink", idle: "text-idle", ended: "text-faint" } as const

/** "active now" / "seen 12m ago", in the presence's colour. */
function PresenceText({ board, row }: { board: BoardState; row: AgentRow }) {
  const now = useNow()
  return <span className={`shrink-0 ${PRESENCE_TEXT[row.presence]}`}>{presenceWords(presenceSubjectOf(board, row.session, row.agent), now)}</span>
}

/** "cello-builder · a13bfb89", or "2fd0505c" and its role for a session. */
function RowName({ row }: { row: AgentRow }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate font-semibold text-ink">{row.kind === "agent" ? row.who.name : row.who.short}</span>
      {row.kind === "session" ? <span className="shrink-0 text-muted">{row.role === "orchestrator" ? `orchestrator · ${row.subagents} subagents` : "session"}</span> : null}
      {row.kind === "agent" && row.who.parentShort ? <span className="shrink-0 text-faint">under {row.who.parentShort}</span> : null}
    </span>
  )
}

/** A task as its board card shows it; a click opens the task. */
function TaskCard({ board, task }: { board: BoardState; task: Task }) {
  const project = board.projects[task.projectId]
  if (!project) return null
  return (
    <Link
      to="/$projectKey/$number"
      params={{ projectKey: project.key, number: String(task.number) }}
      data-agents-card={task.key}
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-left shadow-card outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardBody task={task} board={board} />
    </Link>
  )
}

/** Where a row's task stands, for the collapsed row's right side: its stage, else its status. */
function TaskState({ board, task }: { board: BoardState; task: Task | undefined }) {
  if (!task) return <span className="shrink-0 text-xs text-faint">No task</span>
  const stage = task.stage === null ? undefined : stageInfo(task.stage)
  const status = board.statuses[task.statusId]
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
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

/** What the agent was asked (a subagent's launch description), its session, when it started, its folder. */
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

/** A link to the Review page's open question, for an agent waiting on Lucas. */
function AnswerLink({ task }: { task: Task }) {
  return (
    <Link
      to="/review"
      search={{ open: task.key }}
      className="rounded-sm text-xs font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      Answer on Review
    </Link>
  )
}

/** Where the agent's live log goes in phase 2: what it will show, drawn as a sketch, never as real steps. */
function LogPlaceholder({ compact = false }: { compact?: boolean }) {
  const line = (w: string, faint = false) => <i className={`block h-2 rounded-full ${faint ? "bg-line" : "bg-line-strong"}`} style={{ width: w }} />
  return (
    <section
      aria-label="Live log, coming in phase 2"
      data-log-placeholder
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-dashed border-line-strong bg-sunken px-4 py-3"
    >
      <header className="flex items-center gap-2 text-[13px]">
        <ScrollTextIcon aria-hidden className="size-3.5 text-muted" />
        <span className="font-semibold text-ink">Live log</span>
        <span className="rounded-full bg-hover px-1.5 py-px text-[11px] font-medium text-muted">Coming in phase 2</span>
      </header>
      {compact ? null : (
        <div aria-hidden className="flex flex-col gap-2.5 py-1">
          {[
            ["its messages", "62%"],
            ["Bash · a command", "44%"],
            ["Edit · a file", "36%"],
            ["a result, folded", "54%"],
            ["Read · a file", "30%"],
          ].map(([label, w], i) => (
            <span key={i} className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[11px] text-faint">{label}</span>
              {line(w!, i % 2 === 1)}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        What this agent says and each tool it calls, with the result, newest at the bottom. It follows new steps as they arrive; scroll up to pause.
      </p>
    </section>
  )
}

// ── A · Review-style rows ────────────────────────────────────────────────────────────────────────

/**
 * Like the Review page: one collapsed row per agent, in groups (waiting on you, working, quiet), one
 * open at a time. Open: the card it's on and what it was asked on the left, its live log on the right.
 */
function RowsLayout({ board, rows, openId, onToggle }: { board: BoardState; rows: ReadonlyArray<AgentRow>; openId: string | null; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-6" data-agents-layout="a">
      {agentGroups(rows).map((group) => (
        <section key={group.id} aria-labelledby={`agents-${group.id}`} className="flex flex-col gap-2">
          <h2 id={`agents-${group.id}`} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            {group.id === "waiting" ? <i aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
            {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
          </h2>
          <ul aria-label={group.label} className="flex flex-col gap-2">
            {group.rows.map((row) => (
              <li key={row.id} className={row.kind === "agent" && group.rows.some((r) => r.id === `session:${row.session.id}`) ? "pl-6" : undefined}>
                <AgentQueueRow board={board} row={row} rows={rows} open={row.id === openId} onToggle={() => onToggle(row.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function AgentQueueRow({ board, row, rows, open, onToggle }: { board: BoardState; row: AgentRow; rows: ReadonlyArray<AgentRow>; open: boolean; onToggle: () => void }) {
  const tasks = row.tasks
  const first = tasks[0]
  const bodyId = `agent-body-${row.id}`
  return (
    <article
      data-agent-row={row.id}
      data-open={open ? "" : undefined}
      className="scroll-my-4 rounded-lg border border-line bg-raised shadow-card data-open:border-line-strong"
    >
      <h3 className="text-[13px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring ${open ? "rounded-t-lg" : "rounded-lg"}`}
        >
          <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Mark board={board} row={row} size={18} place="a" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <RowName row={row} />
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <PresenceText board={board} row={row} />
              {first ? (
                <>
                  <span className="text-faint">·</span>
                  <i aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: board.projects[first.projectId]?.color }} />
                  <span className="truncate">
                    {row.kind === "session" ? "holds " : "on "}
                    <span className="tabular-nums">{tasks.map((t) => t.key).join(", ")}</span>
                    {tasks.length === 1 ? ` ${first.title}` : ""}
                  </span>
                </>
              ) : null}
            </span>
          </span>
          {row.kind === "session" && row.role === "orchestrator" ? null : <TaskState board={board} task={first} />}
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="grid gap-5 border-t border-line px-5 py-4 packet-wide:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {groupOf(row) === "waiting" && first ? (
              <p className="flex items-center gap-2 text-[13px] text-ink">
                Waiting for your answer on {first.key}. <AnswerLink task={first} />
              </p>
            ) : null}
            <Facts board={board} row={row} />
            {tasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h4 className="text-xs font-semibold text-muted">{row.kind === "session" ? "Holds" : "Working on"}</h4>
                {(row.kind === "session" ? tasks : directTasks(row, rows)).map((t) => <TaskCard key={t.id} board={board} task={t} />)}
              </div>
            ) : null}
          </div>
          <LogPlaceholder />
        </div>
      ) : null}
    </article>
  )
}

// ── B · Grouped by session ───────────────────────────────────────────────────────────────────────

/**
 * One box per session, the orchestrator as its header and its subagents as rows under it, each with
 * the card it's on beside it. A row opens its live log under it. Sessions waiting on Lucas come first.
 */
function SessionsLayout({ board, rows, openId, onToggle }: { board: BoardState; rows: ReadonlyArray<AgentRow>; openId: string | null; onToggle: (id: string) => void }) {
  const sessions = rows.filter((r) => r.kind === "session")
  const rank = (s: AgentRow) => {
    const own = [s, ...rows.filter((r) => r.parent?.session.id === s.session.id)].map(groupOf)
    return own.includes("waiting") ? 0 : own.includes("working") ? 1 : 2
  }
  const ordered = [...sessions].sort((a, b) => rank(a) - rank(b))
  return (
    <div className="flex flex-col gap-5" data-agents-layout="b">
      {ordered.map((s) => {
        const subs = rows.filter((r) => r.parent?.session.id === s.session.id)
        const own = directTasks(s, rows)
        return (
          <section key={s.id} data-agent-session={s.session.id} className="overflow-hidden rounded-lg border border-line bg-raised shadow-card">
            <header className="flex items-center gap-3 border-b border-line bg-sunken px-4 py-2.5 text-[13px]">
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Mark board={board} row={s} size={18} place="b" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate font-semibold text-ink">{s.who.name}</span>
                  {s.role === "orchestrator" ? <span className="shrink-0 text-muted">· orchestrator</span> : null}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                  <PresenceText board={board} row={s} />
                  {s.tasks.length ? (
                    <>
                      <span className="text-faint">·</span>
                      <span className="truncate tabular-nums">holds {s.tasks.map((t) => t.key).join(", ")}</span>
                    </>
                  ) : null}
                  {s.session.cwd ? (
                    <>
                      <span className="text-faint">·</span>
                      <FolderIcon aria-hidden className="size-3 shrink-0 text-faint" />
                      <span className="truncate">{s.session.cwd.split("/").filter(Boolean).at(-1)}</span>
                    </>
                  ) : null}
                </span>
              </span>
              {groupOf(s) === "waiting" && s.tasks[0] ? <AnswerLink task={s.tasks[0]} /> : null}
            </header>
            <ul className="flex flex-col divide-y divide-line">
              {own.length > 0 ? (
                <SessionRow board={board} row={s} tasks={own} label="On it itself" open={openId === s.id} onToggle={() => onToggle(s.id)} />
              ) : null}
              {subs.map((r) => (
                <SessionRow key={r.id} board={board} row={r} tasks={r.tasks} open={openId === r.id} onToggle={() => onToggle(r.id)} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function SessionRow({ board, row, tasks, label, open, onToggle }: {
  board: BoardState
  row: AgentRow
  tasks: ReadonlyArray<Task>
  /** Names the session's own row ("On it itself"), in place of a subagent's name. */
  label?: string
  open: boolean
  onToggle: () => void
}) {
  const now = useNow()
  return (
    <li data-agent-row={row.id} data-open={open ? "" : undefined}>
      <div className="grid items-start gap-4 px-4 py-3 packet-wide:grid-cols-[minmax(0,1fr)_420px] @min-[44rem]/packet:grid-cols-[minmax(0,1fr)_320px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 items-start gap-3 rounded-md p-1 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon aria-hidden className={`mt-0.5 size-3.5 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
          <span className="flex size-5 shrink-0 items-center justify-center">
            {label ? null : <Mark board={board} row={row} size={18} place="b-row" />}
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-semibold text-ink">{label ?? row.who.name}</span>
            <span className="text-xs text-muted">
              {label ? "no subagent on these" : <PresenceText board={board} row={row} />}
              {!label && row.agent?.startedAt ? <span className="text-faint"> · started {agoShort(row.agent.startedAt, now)}</span> : null}
            </span>
            {row.agent?.description ? <span className="line-clamp-2 text-xs text-muted">“{row.agent.description}”</span> : null}
          </span>
        </button>
        <div className="flex flex-col gap-2">
          {tasks.length ? tasks.map((t) => <TaskCard key={t.id} board={board} task={t} />) : <span className="text-xs text-faint">No task</span>}
        </div>
      </div>
      {open ? (
        <div className="px-4 pb-4">
          <LogPlaceholder />
        </div>
      ) : null}
    </li>
  )
}

// ── C · Cards grid ───────────────────────────────────────────────────────────────────────────────

/** Each agent as a card in a grid, in groups: its mark, who it is, what it was asked, and the card it's on. */
function CardsLayout({ board, rows }: { board: BoardState; rows: ReadonlyArray<AgentRow> }) {
  return (
    <div className="flex flex-col gap-6" data-agents-layout="c">
      {agentGroups(rows).map((group) => (
        <section key={group.id} aria-labelledby={`agents-c-${group.id}`} className="flex flex-col gap-2">
          <h2 id={`agents-c-${group.id}`} className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            {group.id === "waiting" ? <i aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
            {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
          </h2>
          <ul aria-label={group.label} className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {group.rows.map((row) => (
              <li key={row.id}>
                <AgentCard board={board} row={row} rows={rows} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function AgentCard({ board, row, rows }: { board: BoardState; row: AgentRow; rows: ReadonlyArray<AgentRow> }) {
  const tasks = directTasks(row, rows)
  const others = row.tasks.filter((t) => !tasks.includes(t))
  return (
    <article data-agent-row={row.id} className="flex h-full flex-col gap-3 rounded-lg border border-line bg-raised p-4 shadow-card">
      <header className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken">
          <Mark board={board} row={row} size={22} place="c" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px]">
          <span className="truncate font-semibold text-ink">{row.kind === "agent" ? row.who.name : row.who.short}</span>
          <span className="truncate text-xs text-muted">
            {row.kind === "agent" ? `under ${row.who.parentShort ?? "its session"}` : row.role === "orchestrator" ? `orchestrator · ${row.subagents} subagents` : row.session.clientName}
          </span>
        </span>
        <span className="text-xs">
          <PresenceText board={board} row={row} />
        </span>
      </header>
      {row.agent?.description ? <p className="line-clamp-2 text-xs text-muted">“{row.agent.description}”</p> : null}
      {others.length ? (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="text-muted">Orchestrating {others.map((t) => t.key).join(", ")} through</p>
          <ul className="flex flex-col gap-1">
            {rows.filter((r) => r.parent?.session.id === row.session.id).map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-2 rounded-md bg-sunken px-2 py-1.5">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Mark board={board} row={r} size={14} place="c-sub" />
                </span>
                <span className="truncate text-ink">{r.who.name}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted">{r.tasks.map((t) => t.key).join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">{tasks.map((t) => <TaskCard key={t.id} board={board} task={t} />)}</div>
      <footer className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs">
        {groupOf(row) === "waiting" && tasks[0] ? <AnswerLink task={tasks[0]} /> : <span />}
        <span className="flex items-center gap-1 text-faint" title="The live log comes in phase 2">
          <ScrollTextIcon aria-hidden className="size-3" />
          Log · phase 2
        </span>
      </footer>
    </article>
  )
}
