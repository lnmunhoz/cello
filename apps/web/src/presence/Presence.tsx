// Who made a task, who's on it and where it is inside In Progress (CEL-5, CEL-35), in words: the
// card's work and provenance lines, the list row's, the task panel's header and properties, and the
// sidebar's "Agents working". The model is ./model.ts; presence is @cello/shared/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Task } from "@cello/contract/entities"
import type { StageInfo } from "@cello/contract/stages"
import { agoShort, type Presence, presenceOf, presenceWords } from "@cello/shared/presence"
import { BotIcon, CircleDotIcon, GitMergeIcon, HammerIcon, type LucideIcon, ScanEyeIcon, WrenchIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { AgentMark } from "../components/ui/AgentMark.tsx"
import { formatDay } from "../lib/format.ts"
import {
  agentMood,
  type Holder,
  markEntry,
  type MarkSeen,
  type Provenance,
  provenanceLine,
  provenanceOf,
  sessionColor,
  type Who,
  workingSessions,
} from "./model.ts"
import { drawnMarks } from "./drawnMarks.ts"
import { useNow } from "./useNow.ts"

const STAGE_ICONS: Record<string, LucideIcon> = { hammer: HammerIcon, "scan-eye": ScanEyeIcon, wrench: WrenchIcon, "git-merge": GitMergeIcon }

const PRESENCE_TEXT: Record<Presence, string> = { active: "text-ink", idle: "text-idle", ended: "text-faint" }

/** The stage's icon, in its colour, then its name: "🔨 Building". */
export function StageWord({ stage }: { stage: StageInfo }) {
  const Icon = STAGE_ICONS[stage.icon] ?? CircleDotIcon
  return (
    <span className="flex shrink-0 items-center gap-1 font-medium text-ink" data-stage={stage.id}>
      <Icon aria-hidden className="size-3" style={{ color: stage.color }} />
      {stage.label}
    </span>
  )
}

/** The stage as a chip, for the list's stage column when In Progress is grouped by stage. */
export function StageChip({ stage }: { stage: StageInfo }) {
  const Icon = STAGE_ICONS[stage.icon] ?? CircleDotIcon
  return (
    <span
      data-stage={stage.id}
      className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap"
      style={{ color: stage.color, background: `color-mix(in srgb, ${stage.color} 13%, transparent)` }}
    >
      <Icon aria-hidden className="size-3" />
      {stage.label}
    </span>
  )
}

/**
 * A lane's heading in the In Progress column: the stage, "No stage", or "Needs input" (`waiting`: the
 * folded Needs input cards below the lanes), and how many cards it holds.
 */
export function LaneHeading({ stage, count, waiting = false }: { stage: StageInfo | null; count: number; waiting?: boolean }) {
  const Icon = stage ? (STAGE_ICONS[stage.icon] ?? CircleDotIcon) : null
  return (
    <p
      data-lane={stage?.id ?? (waiting ? "needs-input" : "none")}
      className="flex h-6 shrink-0 items-center gap-1.5 px-1 pt-1 text-[11px] font-semibold text-muted"
      style={stage ? { color: stage.color } : undefined}
    >
      {Icon ? <Icon aria-hidden className="size-3" /> : null}
      {stage?.label ?? (waiting ? "Needs input" : "No stage")}
      <span className="font-normal tabular-nums text-muted">{count}</span>
    </p>
  )
}

/**
 * A session's presence: a solid dot in its colour while active, an amber ring when quiet, a grey ring
 * once ended. Each check-in that arrives while it's on screen plays one ripple; nothing loops.
 */
export function PresenceDot({ session, size = 8 }: { session: AgentSession; size?: number }) {
  const now = useNow()
  const presence = presenceOf(session, now)
  const color = sessionColor(session)
  // The check-in it was first drawn with: only later ones ripple, so a page load stays still.
  const [first] = useState(session.lastSeenAt)
  const rippled = presence === "active" && session.lastSeenAt !== first
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      data-presence={presence}
      data-checked-in={session.lastSeenAt}
      aria-hidden
    >
      {rippled ? <span key={session.lastSeenAt} className="presence-ripple" data-ripple style={{ background: color }} /> : null}
      {presence === "active" ? (
        <span className="relative inline-flex size-full rounded-full" style={{ background: color }} />
      ) : (
        <span className={`inline-flex size-full rounded-full border-[1.5px] ${presence === "idle" ? "border-idle" : "border-faint"}`} />
      )}
    </span>
  )
}

/** The mark's size on cards and list rows: about a line of their 12 px text. */
const MARK_SIZE = 15

/** The mark's body: the session's colour while it's active, amber when quiet and grey once ended, like the dot's rings. */
const markBody = (session: AgentSession, presence: Presence) =>
  presence === "active" ? sessionColor(session) : presence === "idle" ? "var(--idle)" : "var(--faint)"

/** Each task's mark as last drawn, outliving the card for a column move (./drawnMarks.ts). */
const drawn = drawnMarks<MarkSeen & { readonly session: AgentSession | null }>()

/**
 * The agent mark for a task's card or list row (CEL-69), in place of the presence dot: what its agent is
 * doing (agentMood), and the entry to play once when the task moves into In Review or Done, or starts
 * waiting in Needs input, while it's on screen. A page load, or coming back to a card that was off
 * screen, plays nothing: what's drawn first is the baseline. When Lucas approves and the claim ends,
 * the session that held it stays for Done, then leaves.
 */
function useTaskMark(task: Task, board: BoardState, holder: AgentSession | null): { mark: ReactNode; leaving: boolean } {
  const now = useNow()
  const presence: Presence = holder ? presenceOf(holder, now) : "ended"
  const seen: MarkSeen = { mood: agentMood(task.stage, board.statuses[task.statusId], presence), statusId: task.statusId }
  const [last, setLast] = useState(() => drawn.baseline(task.id, Date.now()) ?? { ...seen, session: holder })
  // The entry playing right now, if any; it clears once played.
  const [entry, setEntry] = useState<"done" | "waiting" | null>(null)
  // The session whose claim ended as the task finished (Lucas approved it): it stays to play Done.
  const [gone, setGone] = useState<AgentSession | null>(null)
  if (last.mood !== seen.mood || last.statusId !== seen.statusId || last.session?.id !== holder?.id) {
    setLast({ ...seen, session: holder })
    const next = last.mood !== seen.mood || last.statusId !== seen.statusId ? markEntry(last, seen) : entry
    setEntry(next)
    // The leaving mark relies on the approve moving the task and ending the claim in one change (one
    // transaction, one event), so the card sees Done and no holder together. Were they to arrive
    // separately, Done would play with the holder and, once over, a later claim end shows nothing more.
    setGone(next === "done" && holder === null ? (last.session ?? gone) : null)
  }
  // Only when what the mark shows changes: a 200-card board re-renders every card on each event.
  useEffect(() => {
    drawn.seen(task.id, { mood: seen.mood, statusId: seen.statusId, session: holder })
  }, [task.id, seen.mood, seen.statusId, holder?.id])
  // Leaving the screen (not each re-render) starts the baseline's short lifetime.
  useEffect(() => () => drawn.left(task.id, Date.now()), [task.id])
  const session = holder ?? gone
  if (session === null) return { mark: null, leaving: false }
  const played = () => {
    setEntry(null)
    setGone(null)
  }
  const mark = (
    <AgentMark
      mood={seen.mood}
      play={entry !== null}
      size={MARK_SIZE}
      body={markBody(session, holder ? presence : "active")}
      eye="white"
      onPlayed={played}
      data-presence={holder ? presence : undefined}
      data-leaving={holder ? undefined : ""}
    />
  )
  return { mark, leaving: holder === null }
}

/**
 * "8a41c9e2 active now" next to its dot, coloured by presence. `boxed`: the dot sits in an avatar-sized
 * box, to line up with avatars. `mark`: drawn in place of the dot (the card's and the row's agent mark).
 */
function HolderWords({ holder, full = false, boxed = false, mark }: { holder: Holder & { session: AgentSession }; full?: boolean; boxed?: boolean; mark?: ReactNode }) {
  const now = useNow()
  const presence = presenceOf(holder.session, now)
  return (
    <span className={`flex min-w-0 items-center ${boxed ? "gap-2" : "gap-1.5"} ${PRESENCE_TEXT[presence]}`}>
      {mark ?? (boxed ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <PresenceDot session={holder.session} />
        </span>
      ) : (
        <PresenceDot session={holder.session} />
      ))}
      <span className="truncate">
        <span className="font-medium">{full ? holder.who.name : holder.who.short}</span> {presenceWords(holder.session, now)}
      </span>
    </span>
  )
}

const withSession = (holder: Holder | null): (Holder & { session: AgentSession }) | null =>
  holder !== null && holder.session !== null ? (holder as Holder & { session: AgentSession }) : null

/**
 * The card's work line, while an agent session holds the task or it has a stage: who's on it and
 * whether it's working, then the stage at the right. `stage: false` leaves the stage out (its lane says it).
 */
export function CardWork({ task, board, stage = true }: { task: Task; board: BoardState; stage?: boolean }) {
  const p = provenanceOf(board, task)
  const holder = withSession(p.holder)
  const { mark, leaving } = useTaskMark(task, board, holder?.session ?? null)
  const shownStage = stage ? p.stage : null
  if (!holder && !shownStage && !leaving) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-card-work>
      {holder ? <HolderWords holder={holder} mark={mark} /> : leaving ? mark : null}
      {shownStage ? (
        <span className="ml-auto">
          <StageWord stage={shownStage} />
        </span>
      ) : null}
    </span>
  )
}

/** "Lucas created · 8a41c9e2 changed 4m ago", or "commented" when the latest activity is a comment. */
export function ProvenanceLine({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task)
  return (
    <span className="truncate text-xs text-faint" data-provenance title={fullProvenance(p, now)}>
      {provenanceLine(p, now)}
    </span>
  )
}

const fullProvenance = (p: Provenance, now: number) =>
  `Created by ${p.createdBy.name}, ${formatDay(p.createdAt, now)}` +
  (p.changedBy ? ` · last ${p.changeVerb} by ${p.changedBy.name}, ${agoShort(p.changedAt, now)}` : "")

/** The list row's work: the holder and its presence, and the stage unless the stage column shows it. */
export function RowWork({ task, board, stage = true }: { task: Task; board: BoardState; stage?: boolean }) {
  const p = provenanceOf(board, task)
  const holder = withSession(p.holder)
  const { mark, leaving } = useTaskMark(task, board, holder?.session ?? null)
  if (!holder && !(stage && p.stage) && !leaving) return null
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs" data-row-work>
      {holder ? <HolderWords holder={holder} mark={mark} /> : leaving ? mark : null}
      {/* A fixed slot, so the stages down the list line up. */}
      {stage && p.stage ? (
        <span className="flex w-[118px]">
          <StageWord stage={p.stage} />
        </span>
      ) : null}
    </span>
  )
}

/** The list row's last column: "Lucas · Nov 14", the whole provenance on hover. */
export function RowCreated({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task)
  return (
    <span
      className="w-28 shrink-0 truncate text-right text-xs text-muted"
      data-provenance
      title={fullProvenance(p, now)}
    >
      <span className="sr-only">Created by </span>
      {p.createdBy.short} · {formatDay(p.createdAt, now)}
    </span>
  )
}

/** In the task panel's top bar, after the key: "· ● 8a41c9e2 active now · 🔨 Building" (the full name is in Working on it). */
export function PanelWork({ task, board }: { task: Task; board: BoardState }) {
  const p = provenanceOf(board, task)
  const holder = withSession(p.holder)
  if (!holder && !p.stage) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-panel-work>
      {holder ? (
        <>
          <span className="text-faint">·</span>
          <HolderWords holder={holder} />
        </>
      ) : null}
      {p.stage ? (
        <>
          <span className="text-faint">·</span>
          <StageWord stage={p.stage} />
        </>
      ) : null}
    </span>
  )
}

const Avatar = ({ who }: { who: Who }) => (
  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ background: who.color }}>
    {who.kind === "agent" ? <BotIcon aria-hidden className="size-2.5" /> : who.short.slice(0, 1).toUpperCase()}
  </span>
)

/** The task panel's Created by, Last changed and Working on it rows. */
export function ProvenanceRows({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task)
  const holder = p.holder
  const row = "flex h-8 min-w-0 items-center gap-2 px-2"
  return (
    <>
      <dt className="text-muted">Created by</dt>
      <dd className={row} data-created-by>
        <Avatar who={p.createdBy} />
        <span className="truncate">{p.createdBy.name}</span>
        <span className="shrink-0 text-faint">· {formatDay(p.createdAt, now)}</span>
      </dd>
      <dt className="text-muted">Last changed</dt>
      <dd className={row} data-last-changed>
        {p.changedBy ? (
          <>
            <Avatar who={p.changedBy} />
            <span className="truncate">{p.changedBy.name}</span>
            <span className="shrink-0 text-faint">
              · {p.changeVerb === "commented" ? "commented " : ""}
              {agoShort(p.changedAt, now)}
            </span>
          </>
        ) : (
          <span className="text-muted">Not since it was created</span>
        )}
      </dd>
      <dt className="text-muted">Working on it</dt>
      <dd className={row} data-working-on-it>
        {holder?.session ? (
          <HolderWords holder={holder as Holder & { session: AgentSession }} full boxed />
        ) : holder ? (
          <>
            <Avatar who={holder.who} />
            <span className="truncate">{holder.who.name}</span>
          </>
        ) : (
          <span className="text-muted">Nobody</span>
        )}
      </dd>
    </>
  )
}

/** The agent sessions working in the workspace right now, for the sidebar. */
const useAgentsWorking = (board: BoardState, workspaceId: string) => {
  const now = useNow()
  const sessions = workingSessions(board, workspaceId, now)
  return { sessions, active: sessions.filter((s) => s.presence === "active"), now }
}

const workingTitle = (sessions: ReturnType<typeof workingSessions>, now: number) =>
  sessions.length === 0
    ? "No agent holds a task"
    : sessions.map((s) => `${s.who.name}: ${presenceWords(s.session, now)} (${s.tasks.map((t) => t.key).join(", ")})`).join("\n")

/** Under Review in the expanded sidebar: "Agents working 2". */
export function AgentsWorking({ board, workspaceId, className }: { board: BoardState; workspaceId: string; className: string }) {
  const { sessions, active, now } = useAgentsWorking(board, workspaceId)
  const lead = active[0]
  return (
    <p className={className} data-agents-working={active.length} title={workingTitle(sessions, now)}>
      <span className="flex size-3.5 items-center justify-center">
        {lead ? <PresenceDot session={lead.session} size={7} /> : <i className="size-1.5 rounded-full bg-line-strong" />}
      </span>
      Agents working
      <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-hover px-1.5 text-[11px] font-semibold tabular-nums text-ink">
        {active.length}
      </span>
    </p>
  )
}

/** On the sidebar's rail: a bot with the count of agents working. */
export function AgentsWorkingRail({ board, workspaceId, className }: { board: BoardState; workspaceId: string; className: string }) {
  const { sessions, active, now } = useAgentsWorking(board, workspaceId)
  return (
    <span className={className} data-agents-working={active.length} title={`Agents working: ${active.length}\n${workingTitle(sessions, now)}`}>
      <BotIcon aria-hidden className="size-4" />
      <span className="sr-only">Agents working: {active.length}</span>
      {active.length > 0 ? (
        <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hover px-1 text-[10px] font-semibold tabular-nums text-ink ring-2 ring-canvas">
          {active.length}
        </span>
      ) : null}
    </span>
  )
}
