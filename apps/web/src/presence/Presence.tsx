// Who made a task, who's on it and where it is inside In Progress (CEL-5, CEL-35), in words: the
// card's work and provenance lines, the list row's, the task panel's header and properties, and the
// sidebar's "Agents working". A subagent (CEL-55) is named on its own, its session in the hover and in
// the panel. The model is ./model.ts; presence is @cello/domain/presence.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import type { StageInfo } from "@cello/contract/stages"
import { modelName } from "@cello/domain/model"
import { agoShort, type Presence, presenceOf, presenceWords, type SessionLike } from "@cello/domain/presence"
import { ActivityIcon, BotIcon, CircleDotIcon, GitMergeIcon, GitPullRequestArrowIcon, HammerIcon, ListChecksIcon, type LucideIcon, ScanEyeIcon, WrenchIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { logLinkOf } from "../agents/layout.ts"
import { AgentMark, type AgentMood } from "../components/ui/AgentMark.tsx"
import { LinkButton } from "../components/ui/Button.tsx"
import { formatDay } from "../lib/format.ts"
import { drawnMarks } from "./drawnMarks.ts"
import { OriginBadge } from "./OriginBadge.tsx"
import { testRunOf, TestRunWord } from "./TestRun.tsx"
import {
  agentMood,
  agentPresenceSubject,
  agentsWorkingByProject,
  agentsWorkingCount,
  type Holder,
  markEntry,
  type MarkSeen,
  type Provenance,
  type ProjectWorking,
  provenanceLine,
  provenanceOf,
  sessionColor,
  sessionWho,
  type Who,
  type Working,
  type WorkingMark,
  workingSessions,
} from "./model.ts"
import { useNow } from "./useNow.ts"

export const STAGE_ICONS: Record<string, LucideIcon> = {
  "list-checks": ListChecksIcon,
  hammer: HammerIcon,
  "scan-eye": ScanEyeIcon,
  wrench: WrenchIcon,
  "git-merge": GitMergeIcon,
  "git-pull-request-arrow": GitPullRequestArrowIcon,
  activity: ActivityIcon,
}

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
 * A lane's heading in the In Progress column: the stage, Working (CEL-105), "No stage", or "Needs input" (`waiting`: the
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
 * A session's (or a subagent's) presence: a solid dot in its colour while active, an amber ring when
 * quiet, a grey ring once ended. Each check-in that arrives while it's on screen plays one ripple;
 * nothing loops. `of` is what it reads: the session, or the agent (ended with its session).
 */
export function PresenceDot({ of: session, color, size = 8 }: { of: SessionLike; color: string; size?: number }) {
  const now = useNow()
  const presence = presenceOf(session, now)
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

/** A holder with a presence to show: a subagent, or an agent session (Lucas has none). */
interface LiveHolder {
  readonly holder: Holder
  /** What the dot and the words read. */
  readonly subject: SessionLike
  readonly color: string
}

/** The holder's presence, when it has one: the subagent's (ended with its session), else the session's. */
const live = (board: BoardState, holder: Holder | null): LiveHolder | null => {
  if (holder === null) return null
  if (holder.agent) return { holder, subject: agentPresenceSubject(board, holder.agent), color: holder.who.color }
  if (holder.session) return { holder, subject: holder.session, color: sessionColor(holder.session) }
  return null
}

/** "Under Claude Code session 2fd0505c": a subagent's parent, for its hover. */
const parentTitle = (who: Who) => (who.parent ? `${who.name}, under ${who.parent}` : undefined)

/** "Claude Code session 2fd0505c (Opus 5.5)": a name with the model it's on now, when known (CEL-119). */
const withModel = (who: Who) => (who.model ? `${who.name} (${modelName(who.model)})` : who.name)

/** Which holder it is: the subagent, else the session. */
const liveId = (h: LiveHolder | null) => (h === null ? null : h.holder.agent ? `agent:${h.holder.agent.agentId}` : `session:${h.holder.session?.id}`)

/** The mark's size on cards, list rows and in the task panel: about a line of their 12 px text. */
export const MARK_SIZE = 15

/** The mark's size in the sidebar's Agents working list (CEL-55). */
const SIDEBAR_MARK_SIZE = 14

/** The mark's body: the holder's colour while it's active, amber when quiet and grey once ended, like the dot's rings. */
const markBody = (color: string, presence: Presence) => (presence === "active" ? color : presence === "idle" ? "var(--idle)" : "var(--faint)")

/** Each mark as last drawn, by where it is, outliving the card for a column move (./drawnMarks.ts). */
const drawn = drawnMarks<MarkSeen & { readonly holder: LiveHolder | null }>()

/**
 * The agent mark for a task's card or list row (CEL-69), in place of the presence dot, and for the task
 * panel's (`place`, CEL-55). It follows whoever the holder line names (a subagent, else the session: its
 * colour and presence) and shows what it's doing (agentMood). A page load, or coming back to a card that
 * was off screen, plays no entry: what's drawn first is the baseline. When Lucas approves and the claim
 * ends, the holder stays for Done, then leaves.
 */
function useTaskMark(task: Task, board: BoardState, holder: LiveHolder | null, place: "card" | "panel" | "panel-bar" | "preview" = "card") {
  const now = useNow()
  const presence: Presence = holder ? presenceOf(holder.subject, now) : "ended"
  const mood = agentMood(task.stage, board.statuses[task.statusId], presence)
  // The card and the list row are never on screen together, so they share what the card drew.
  return useAgentMark(place === "card" ? task.id : `${place}:${task.id}`, mood, task.statusId, holder, MARK_SIZE)
}

/**
 * The agent mark, as the cards show it (CEL-69): `mood` in the holder's colour and presence. `id` says
 * where it is drawn, for its baseline. Working and thinking loop while the holder is active, page load
 * included: an agent at work looks alive wherever its mark is (card, panel, sidebar), and the mark rests
 * once it goes quiet (the 30 s clock, useNow, notices). The entries play once, only for a change seen on
 * screen (markEntry): Done when the task moves into In Review or Done, the hop when it starts waiting in
 * Needs input. An idle board runs nothing.
 */
function useAgentMark(id: string, mood: AgentMood, statusId: string, holder: LiveHolder | null, size: number): { mark: ReactNode; leaving: boolean } {
  const now = useNow()
  const presence: Presence = holder ? presenceOf(holder.subject, now) : "ended"
  const seen: MarkSeen = { mood, statusId }
  const [last, setLast] = useState(() => drawn.baseline(id, Date.now()) ?? { ...seen, holder })
  // The entry playing right now, if any; it clears once played.
  const [entry, setEntry] = useState<"done" | "waiting" | null>(null)
  // The holder whose claim ended as the task finished (Lucas approved it): it stays to play Done.
  const [gone, setGone] = useState<LiveHolder | null>(null)
  const changed = last.mood !== seen.mood || last.statusId !== seen.statusId
  if (changed || liveId(last.holder) !== liveId(holder)) {
    setLast({ ...seen, holder })
    const next = changed ? markEntry(last, seen) : entry
    setEntry(next)
    // The leaving mark relies on the approve moving the task and ending the claim in one change (one
    // transaction, one event), so the card sees Done and no holder together. Were they to arrive
    // separately, Done would play with the holder and, once over, a later claim end shows nothing more.
    setGone(next === "done" && holder === null ? (last.holder ?? gone) : null)
  }
  // Only when what the mark shows changes: a 200-card board re-renders every card on each event.
  useEffect(() => {
    drawn.seen(id, { mood: seen.mood, statusId: seen.statusId, holder })
  }, [id, seen.mood, seen.statusId, liveId(holder)])
  // Leaving the screen (not each re-render) starts the baseline's short lifetime.
  useEffect(() => () => drawn.left(id, Date.now()), [id])
  const shown = holder ?? gone
  if (shown === null) return { mark: null, leaving: false }
  const played = () => {
    setEntry(null)
    setGone(null)
  }
  const mark = (
    <AgentMark
      mood={seen.mood}
      play={entry !== null}
      size={size}
      body={markBody(shown.color, holder ? presence : "active")}
      eye="white"
      onPlayed={played}
      data-presence={holder ? presence : undefined}
      data-leaving={holder ? undefined : ""}
    />
  )
  return { mark, leaving: holder === null }
}

/**
 * "8a41c9e2 active now" or "cello-builder · a13bfb89 active now" after its agent mark (CEL-69), coloured
 * by presence; a subagent's session is in the hover, and with `full` it's written after it. `boxed`: the
 * mark sits in an avatar-sized box, to line up with avatars. The model it's on now (CEL-119) follows the
 * name on a card ("(Sonnet 5.5)"); `stacked` (the task panel) gives a known model a second line, the
 * presence words then the model and effort, muted ("active now · Sonnet 5.5 · medium"), so a long name in
 * a narrow header doesn't cut either off.
 */
function HolderWords({
  live: { holder, subject },
  full = false,
  boxed = false,
  stacked = false,
  mark,
}: { live: LiveHolder; full?: boolean; boxed?: boolean; stacked?: boolean; mark: ReactNode }) {
  const now = useNow()
  const presence = presenceOf(subject, now)
  const model = holder.who.model ? modelName(holder.who.model) : null
  return (
    <span
      className={`flex min-w-0 items-center ${boxed ? "gap-2" : "gap-1.5"} ${PRESENCE_TEXT[presence]}`}
      title={parentTitle(holder.who)}
      data-agent={holder.agent?.agentId}
    >
      {boxed ? <span className="flex size-4 shrink-0 items-center justify-center">{mark}</span> : mark}
      {model && stacked ? (
        <span className="flex min-w-0 flex-col leading-4">
          <span className="truncate" data-holder-name>
            <span className="font-medium">{full ? holder.who.name : holder.who.short}</span>
            {full && holder.who.parentShort ? <span className="text-faint"> · under {holder.who.parentShort}</span> : null}
          </span>
          <span className="truncate text-[11px]">
            {presenceWords(subject, now)}
            <span className="text-faint" data-holder-model>
              {" · "}
              {model}
              {holder.who.effort ? ` · ${holder.who.effort}` : ""}
            </span>
          </span>
        </span>
      ) : (
        <span className="truncate" data-holder-name>
          <span className="font-medium">{full ? holder.who.name : holder.who.short}</span>
          {model ? <span className="text-faint" data-holder-model> ({model})</span> : null} {presenceWords(subject, now)}
          {full && holder.who.parentShort ? <span className="text-faint"> · under {holder.who.parentShort}</span> : null}
        </span>
      )}
    </span>
  )
}

/**
 * The card's work line, while an agent works on the task or it has a stage: who's on it (the subagent
 * working on it, else the agent session holding it) and whether it's working, then the stage at the
 * right: the stage, or Working with no stage while its agent is active (CEL-105). `stage: false` leaves
 * it out (its lane says it).
 */
export function CardWork({ task, board, stage = true }: { task: Task; board: BoardState; stage?: boolean }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const holder = live(board, p.holder)
  const { mark, leaving } = useTaskMark(task, board, holder)
  const shownStage = stage ? p.step : null
  const run = holderRun(holder)
  if (!holder && !shownStage && !leaving) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-card-work>
      {holder ? <HolderWords live={holder} mark={mark} /> : leaving ? mark : null}
      {shownStage || run ? (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {shownStage ? <StageWord stage={shownStage} /> : null}
          <TestRunWord run={run} compact />
        </span>
      ) : null}
    </span>
  )
}

/** The test run of whoever is on the task (CEL-134): its subagent's, else its session's. */
const holderRun = (holder: LiveHolder | null) => (holder ? testRunOf(holder.holder.session, holder.holder.agent) : null)

/** "Lucas created · 8a41c9e2 changed 4m ago", or "commented" when the latest activity is a comment. */
export function ProvenanceLine({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  return (
    <span className="truncate text-xs text-faint" data-provenance title={fullProvenance(p, now)}>
      {provenanceLine(p, now)}
    </span>
  )
}

const named = (who: Who) => (who.parent ? `${who.name} (under ${who.parent})` : who.name)

const fullProvenance = (p: Provenance, now: number) =>
  `Created by ${named(p.createdBy)}, ${formatDay(p.createdAt, now)}` +
  (p.changedBy ? ` · last ${p.changeVerb} by ${named(p.changedBy)}, ${agoShort(p.changedAt, now)}` : "")

/** The list row's work: the holder and its presence, and the stage (or Working) unless the stage column shows it. */
export function RowWork({ task, board, stage = true }: { task: Task; board: BoardState; stage?: boolean }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const holder = live(board, p.holder)
  const { mark, leaving } = useTaskMark(task, board, holder)
  if (!holder && !(stage && p.step) && !leaving) return null
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs" data-row-work>
      {holder ? <HolderWords live={holder} mark={mark} /> : leaving ? mark : null}
      {/* A fixed slot, so the stages down the list line up. */}
      {stage && p.step ? (
        <span className="flex w-[118px]">
          <StageWord stage={p.step} />
        </span>
      ) : null}
    </span>
  )
}

/** The list row's last column: "Lucas · Nov 14", the whole provenance on hover. */
export function RowCreated({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
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

/**
 * In the task panel's top bar, after the key: "· 8a41c9e2 active now · 🔨 Building" after the card's agent
 * mark, in the card's mood (the full name is in Working on it); "· Working" with no stage while its agent
 * is active (CEL-105).
 */
export function PanelWork({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const holder = live(board, p.holder)
  const { mark, leaving } = useTaskMark(task, board, holder, "panel-bar")
  if (!holder && !p.step && !leaving) return null
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-panel-work>
      {holder || leaving ? <span className="text-faint">·</span> : null}
      {holder ? <HolderWords live={holder} stacked mark={mark} /> : leaving ? mark : null}
      {p.step ? (
        <>
          <span className="text-faint">·</span>
          <StageWord stage={p.step} />
        </>
      ) : null}
      <TestRunWord run={holderRun(holder)} />
    </span>
  )
}

/**
 * In a task link's hover card (CEL-142): who's on it (the agent mark, its name and presence, and where
 * its session runs, CEL-137), then the stage; "Nobody on it" when nobody holds it.
 */
export function PreviewWork({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const shown = live(board, p.holder)
  const { mark } = useTaskMark(task, board, shown, "preview")
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs" data-preview-work>
      {shown ? (
        <>
          <HolderWords live={shown} mark={mark} />
          {shown.holder.session ? <OriginBadge session={shown.holder.session} /> : null}
        </>
      ) : p.holder ? (
        <>
          <Avatar who={p.holder.who} />
          <span className="truncate">{p.holder.who.name}</span>
        </>
      ) : (
        <span className="text-muted">Nobody on it</span>
      )}
      {p.step ? (
        <span className="ml-auto flex shrink-0">
          <StageWord stage={p.step} />
        </span>
      ) : null}
    </span>
  )
}

const Avatar = ({ who }: { who: Who }) => (
  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ background: who.color }}>
    {who.kind === "agent" ? <BotIcon aria-hidden className="size-2.5" /> : who.short.slice(0, 1).toUpperCase()}
  </span>
)

/** A name with its session after it, for a subagent: "cello-builder · a13bfb89 · under 2fd0505c". */
export function WhoName({ who }: { who: Who }) {
  return (
    <span className="truncate" title={parentTitle(who)}>
      {who.name}
      {who.parentShort ? <span className="text-faint"> · under {who.parentShort}</span> : null}
    </span>
  )
}

/**
 * The task panel's Created by, Last changed and Working on it rows. Working on it links the agent's log
 * on the Agents page (CEL-107) while the page has its row: working, or finished today.
 */
export function ProvenanceRows({ task, board }: { task: Task; board: BoardState }) {
  const now = useNow()
  const p = provenanceOf(board, task, now)
  const holder = p.holder
  const shown = live(board, holder)
  const log = holder ? logLinkOf(board, holder, now) : null
  // Working on it shows who's on it now: once the claim ends, "Nobody" (the top bar plays Done's leaving).
  const { mark } = useTaskMark(task, board, shown, "panel")
  const row = "flex h-8 min-w-0 items-center gap-2 px-2"
  return (
    <>
      <dt className="text-muted">Created by</dt>
      <dd className={row} data-created-by>
        <Avatar who={p.createdBy} />
        <WhoName who={p.createdBy} />
        <span className="shrink-0 text-faint">· {formatDay(p.createdAt, now)}</span>
      </dd>
      <dt className="text-muted">Last changed</dt>
      <dd className={row} data-last-changed>
        {p.changedBy ? (
          <>
            <Avatar who={p.changedBy} />
            <WhoName who={p.changedBy} />
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
        {shown ? (
          <>
            <HolderWords live={shown} full boxed stacked mark={mark} />
            {/* Where its session runs (CEL-137): Terminal, Claude desktop, Woken by Cello. */}
            {shown.holder.session ? <OriginBadge session={shown.holder.session} /> : null}
            {log ? (
              <span className="ml-auto flex shrink-0" data-working-log>
                <LinkButton variant="ghost" size="sm" to="/agents" search={{ open: log }} aria-label={`Open ${shown.holder.who.name}'s log on the Agents page`}>
                  Log
                </LinkButton>
              </span>
            ) : null}
          </>
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

/** The agents working in the workspace right now, for the sidebar: sessions, with their subagents under them. */
const useAgentsWorking = (board: BoardState, workspaceId: string) => {
  const now = useNow()
  const sessions = workingSessions(board, workspaceId, now)
  return { sessions, count: agentsWorkingCount(sessions), now }
}

/**
 * The agents working in each project (CEL-179), for the sidebar's project rows: the same sessions
 * `useAgentsWorking` reads, split by project (agentsWorkingByProject). Takes no board while it loads.
 */
export const useProjectsWorking = (board: BoardState | null, workspaceId: string | null | undefined) => {
  const now = useNow()
  const byProject = board && workspaceId ? agentsWorkingByProject(workingSessions(board, workspaceId, now)) : new Map<string, ProjectWorking[]>()
  return { byProject, now }
}

const keysOf = (tasks: ReadonlyArray<Task>) => tasks.map((t) => t.key).join(", ")

/** A working session's line in a title: who, how recently it checked in, and its tasks. */
const sessionLine = (s: Working, now: number, tasks: ReadonlyArray<Task>) =>
  `${withModel(s.who)}: ${presenceWords(s.session, now)}${tasks.length ? ` (${keysOf(tasks)})` : ""}`

const workingTitle = (sessions: ReadonlyArray<Working>, now: number) =>
  sessions.length === 0
    ? "No agent is working on a task"
    : sessions
      .flatMap((s) => [
        sessionLine(s, now, s.tasks),
        ...s.agents.map((a) => `  ${withModel(a.who)}: ${presenceWords(a.agent, now)}${a.task ? ` (${a.task.key})` : ""}`),
      ])
      .join("\n")

/**
 * The agent mark for a session or one of its subagents, in `look`'s mood, as the sidebar draws it: for
 * the Agents page (CEL-65). `place` keeps its baseline apart from the sidebar's, so each plays its own
 * burst per check-in.
 */
export function AgentMarkOf({ board, session, agent, who, look, size, place }: {
  board: BoardState
  session: AgentSession
  agent: SessionAgent | null
  who: Who
  look: WorkingMark
  size: number
  place: string
}) {
  const holder: LiveHolder = agent
    ? { holder: { who, session, agent }, subject: agentPresenceSubject(board, agent), color: who.color }
    : { holder: { who, session, agent: null }, subject: session, color: sessionColor(session) }
  const { mark } = useAgentMark(`${place}:${liveId(holder)}`, look.mood, look.statusId, holder, size)
  return mark
}

/** What a session's or subagent's presence dot and words read: the agent's, ended with its session. */
export const presenceSubjectOf = (board: BoardState, session: AgentSession, agent: SessionAgent | null): SessionLike =>
  agent ? agentPresenceSubject(board, agent) : session

/**
 * One entry of the sidebar's list: its agent mark, in the mood its card shows (workingMark), and who,
 * and under it, faint, what it's on (the task keys). Two lines, so a long agent name and a task key both
 * fit the sidebar's width.
 */
function WorkingLine({ who, id, live: holder, look, keys, nested, title, data }: {
  who: string
  /** A subagent's short id, after its type: never cut off, so two agents of one type tell apart. */
  id?: string
  live: LiveHolder
  look: WorkingMark
  keys: string
  nested: boolean
  title: string
  data: Record<string, string>
}) {
  const now = useNow()
  const presence = presenceOf(holder.subject, now)
  const { mark } = useAgentMark(`sidebar:${liveId(holder)}`, look.mood, look.statusId, holder, SIDEBAR_MARK_SIZE)
  return (
    <li className={`flex min-w-0 items-start gap-2 py-0.5 pr-2 text-xs ${nested ? "pl-6" : "pl-2"} ${PRESENCE_TEXT[presence]}`} title={title} {...data}>
      <span className="flex size-4 shrink-0 items-center justify-center">{mark}</span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 leading-4" data-working-who>
          <span className="truncate">{who}</span>
          {id ? <span className="shrink-0 whitespace-pre">{` · ${id}`}</span> : null}
        </span>
        {keys ? <span className="truncate leading-4 tabular-nums text-faint" data-working-on>{keys}</span> : null}
      </span>
    </li>
  )
}

/**
 * Under Review in the expanded sidebar: "Agents working 4", counting each working session and each
 * working subagent (CEL-55). It opens the Agents page (CEL-65), marked as the current page while it's
 * open, like Review; the agents are listed there, not under it.
 */
export function AgentsWorking({ board, workspaceId, className }: { board: BoardState; workspaceId: string; className: string }) {
  const { sessions, count, now } = useAgentsWorking(board, workspaceId)
  const lead = sessions.find((s) => s.presence === "active")
  return (
    <Link to="/agents" activeOptions={{ includeSearch: false }} className={className} data-agents-working={count} title={workingTitle(sessions, now)}>
      <span className="flex size-3.5 items-center justify-center">
        {lead ? <PresenceDot of={lead.session} color={sessionColor(lead.session)} size={7} /> : <i className="size-1.5 rounded-full bg-line-strong" />}
      </span>
      Agents working
      <span className="ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-hover px-1.5 text-[11px] font-semibold tabular-nums text-ink">
        {count}
      </span>
    </Link>
  )
}

/** "2 agents working", then each session and the tasks it's on in this project: the badge's title. */
const projectWorkingTitle = (entries: ReadonlyArray<ProjectWorking>, now: number) =>
  [`${entries.length} ${entries.length === 1 ? "agent" : "agents"} working`, ...entries.map((e) => sessionLine(e.working, now, e.tasks))].join("\n")

/** How many times `count` has changed since this component first showed it: 0 while it hasn't, so only a change animates. */
const useChanges = (count: number) => {
  const [seen, setSeen] = useState({ count, changes: 0 })
  if (seen.count !== count) setSeen({ count, changes: seen.changes + 1 })
  return seen.changes
}

const PROJECT_BADGE = {
  // The Agents working pill, right-aligned on the project's row.
  row: "ml-auto flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-hover px-1.5 text-[11px] font-semibold tabular-nums text-ink",
  // The rail's badge, on the corner of the project's square.
  rail: "absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hover px-1 text-[10px] font-semibold tabular-nums text-ink ring-2 ring-canvas",
} as const

/**
 * How many agents are working in a project (CEL-179), on its sidebar row or its square on the rail. Hidden
 * at 0. Its title lists the sessions and their tasks. It pops once when the number changes (count-pop)
 * and otherwise stands still. Always rendered, so a count that goes from 0 to 1 is a change too.
 */
export function ProjectWorkingBadge({ entries, now, variant }: { entries: ReadonlyArray<ProjectWorking>; now: number; variant: keyof typeof PROJECT_BADGE }) {
  const count = entries.length
  const changes = useChanges(count)
  if (count === 0) return null
  return (
    <span key={changes} data-project-working={count} title={projectWorkingTitle(entries, now)} className={`${PROJECT_BADGE[variant]}${changes > 0 ? " count-pop" : ""}`}>
      {count}
      <span className="sr-only"> {count === 1 ? "agent" : "agents"} working</span>
    </span>
  )
}

/**
 * Kept for reference (Lucas, Nov 16): the sidebar's per-agent list, replaced by the Agents page. Not
 * rendered anywhere. Each session ("2fd0505c · orchestrator" when it has subagents) with its
 * subagents under it, each with the task it's on, in its card's mood (CEL-55, CEL-69).
 */
export function AgentsWorkingList({ board, workspaceId }: { board: BoardState; workspaceId: string }) {
  const { sessions, now } = useAgentsWorking(board, workspaceId)
  const listed = sessions.filter((s) => s.presence !== "ended")
  return (
    <>
      {listed.length > 0 ? (
        <ul aria-label="Agents working" className="flex flex-col" data-agents-list>
          {listed.flatMap((s) => [
            <WorkingLine
              key={s.session.id}
              who={s.agents.length ? `${s.who.short} · orchestrator` : s.who.short}
              live={{ holder: { who: s.who, session: s.session, agent: null }, subject: s.session, color: sessionColor(s.session) }}
              look={s.mark}
              keys={s.tasks.length ? `holds ${keysOf(s.tasks)}` : ""}
              nested={false}
              title={`${s.who.name}: ${presenceWords(s.session, now)}`}
              data={{ "data-working-session": s.session.id }}
            />,
            ...s.agents.map((a) => (
              <WorkingLine
                key={`${a.agent.sessionId}/${a.agent.agentId}`}
                who={a.agent.agentType ?? "agent"}
                id={a.agent.agentId.slice(0, 8)}
                live={{ holder: { who: a.who, session: s.session, agent: a.agent }, subject: agentPresenceSubject(board, a.agent), color: a.who.color }}
                look={a.mark}
                keys={a.task ? `on ${a.task.key}` : ""}
                nested
                title={`${a.who.name}, under ${s.who.name}: ${presenceWords(a.agent, now)}${a.agent.description ? `\n${a.agent.description}` : ""}`}
                data={{ "data-working-agent": a.agent.agentId }}
              />
            )),
          ])}
        </ul>
      ) : null}
    </>
  )
}

/** On the sidebar's rail: a bot with the count of agents working, opening the Agents page (CEL-65). */
export function AgentsWorkingRail({ board, workspaceId, className }: { board: BoardState; workspaceId: string; className: string }) {
  const { sessions, count, now } = useAgentsWorking(board, workspaceId)
  return (
    <Link
      to="/agents"
      activeOptions={{ includeSearch: false }}
      className={className}
      data-agents-working={count}
      title={`Agents working: ${count}\n${workingTitle(sessions, now)}`}
    >
      <BotIcon aria-hidden className="size-4" />
      <span className="sr-only">Agents working: {count}</span>
      {count > 0 ? (
        <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hover px-1 text-[10px] font-semibold tabular-nums text-ink ring-2 ring-canvas">
          {count}
        </span>
      ) : null}
    </Link>
  )
}
