// Who made a task, who's on it and where it is inside In Progress (CEL-5, CEL-35), in words: the
// card's work and provenance lines, the list row's, the task panel's header and properties, and the
// sidebar's "Agents working". The model is ./model.ts; presence is @cello/shared/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Task } from "@cello/contract/entities"
import type { StageInfo } from "@cello/contract/stages"
import { agoShort, type Presence, presenceOf, presenceWords } from "@cello/shared/presence"
import { BotIcon, CircleDotIcon, GitMergeIcon, HammerIcon, type LucideIcon, ScanEyeIcon, WrenchIcon } from "lucide-react"
import { useState } from "react"
import { formatDay } from "../lib/format.ts"
import { type Holder, provenanceLine, provenanceOf, sessionColor, type Who, workingSessions } from "./model.ts"
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

/** "8a41c9e2 active now" next to its dot, coloured by presence. `boxed`: the dot sits in an avatar-sized box, to line up with avatars. */
function HolderWords({ holder, full = false, boxed = false }: { holder: Holder & { session: AgentSession }; full?: boolean; boxed?: boolean }) {
  const now = useNow()
  const presence = presenceOf(holder.session, now)
  return (
    <span className={`flex min-w-0 items-center ${boxed ? "gap-2" : "gap-1.5"} ${PRESENCE_TEXT[presence]}`}>
      {boxed ? (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <PresenceDot session={holder.session} />
        </span>
      ) : (
        <PresenceDot session={holder.session} />
      )}
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
  const shownStage = stage ? p.stage : null
  if (!holder && !shownStage) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-card-work>
      {holder ? <HolderWords holder={holder} /> : null}
      {shownStage ? (
        <span className="ml-auto">
          <StageWord stage={shownStage} />
        </span>
      ) : null}
    </span>
  )
}

/** "Lucas created · 8a41c9e2 changed 4m ago". */
export function ProvenanceLine({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task)
  return (
    <span className="truncate text-xs text-faint" data-provenance title={fullProvenance(p.createdBy, p.createdAt, p.changedBy, p.changedAt, now)}>
      {provenanceLine(p, now)}
    </span>
  )
}

const fullProvenance = (createdBy: Who, createdAt: number, changedBy: Who | null, changedAt: number, now: number) =>
  `Created by ${createdBy.name}, ${formatDay(createdAt, now)}` + (changedBy ? ` · last changed by ${changedBy.name}, ${agoShort(changedAt, now)}` : "")

/** The list row's work: the holder and its presence, and the stage unless the stage column shows it. */
export function RowWork({ task, board, stage = true }: { task: Task; board: BoardState; stage?: boolean }) {
  const p = provenanceOf(board, task)
  const holder = withSession(p.holder)
  if (!holder && !(stage && p.stage)) return null
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs" data-row-work>
      {holder ? <HolderWords holder={holder} /> : null}
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
      title={fullProvenance(p.createdBy, p.createdAt, p.changedBy, p.changedAt, now)}
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
            <span className="shrink-0 text-faint">· {agoShort(p.changedAt, now)}</span>
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
