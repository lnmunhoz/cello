// The Issues tab's filter panel (CEL-52): on the left of the board and the list, every property with its
// values, each with a checkbox and how many tasks it would show. Labels come in their groups (Area cut
// to its busiest 6 until "Show all"), and "An agent" opens into the sessions holding claims. Each section
// and label group folds, and the whole panel folds to a rail (./FilterRail.tsx), both kept on this device.
import type { BoardState } from "@cello/client/sync/applyEvents"
import {
  applyFilter,
  countWith,
  type Due,
  type FilterField,
  isActive,
  labelCount,
  labelsInScope,
  type Maker,
  matchContext,
  type MatchContext,
  type TaskFilter,
  type Updated,
  type Waiting,
} from "@cello/client/sync/filters"
import type { Label, Priority, Task } from "@cello/contract/entities"
import { presenceOf, presenceWords } from "@cello/shared/presence"
import {
  BotIcon,
  CalendarClockIcon,
  CalendarIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  ClockIcon,
  FileCheckIcon,
  MessageCircleQuestionIcon,
  UserIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { type Checked, FacetOption } from "../components/ui/FacetOption.tsx"
import { SearchInput } from "../components/ui/Input.tsx"
import { PRIORITY_LABELS, PriorityIcon } from "../components/ui/PriorityIcon.tsx"
import { sessionWho } from "../presence/model.ts"
import { PresenceDot } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"
import { agentBox, claimSessions, labelSections, toggleAgent, toggleSession, TOP_AREAS } from "./facets.ts"
import { FilterRail, HidePanelButton, useFolded, usePanelOpen } from "./FilterRail.tsx"
import { groupKey, pickedValues } from "./panelState.ts"
import { type FilterState, projectTasks, useFilter, useProjectBoard } from "./useFilter.ts"

const icon = "size-3.5 shrink-0 text-muted"
const on = (yes: boolean): Checked => (yes ? "on" : "off")
const toggled = <T,>(list: ReadonlyArray<T>, value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

interface PanelProps {
  readonly state: FilterState
  readonly board: BoardState
  readonly tasks: ReadonlyArray<Task>
  readonly ctx: MatchContext
  /** Which sections are folded on this device, and how to fold one. */
  readonly folds: Folds
}

interface Folds {
  readonly folded: ReadonlyArray<string>
  readonly toggle: (key: string) => void
}

/** The filter panel, or nothing while the board loads. */
export function FacetPanel() {
  const state = useFilter()
  const loaded = useProjectBoard()
  const now = useNow()
  const [sessionsOpen, setSessionsOpen] = useState(state.filter.sessions.length > 0)
  const open = usePanelOpen()
  const [folded, toggleFold] = useFolded()
  if (!loaded) return null
  const { board, workspaceId, project } = loaded
  const me = Object.values(board.actors).find((a) => a.kind === "human")?.name.split(" ")[0] ?? "You"
  // The project's own labels (CEL-80): another project's Kinds and Areas aren't offered here.
  const labels = labelsInScope(board, { projectId: project.id })
  const picked = pickedValues(state.filter, {
    labels: new Map(labels.map((l) => [l.name.toLowerCase(), l.name])),
    sessions: new Map(Object.values(board.sessions).map((s) => [s.id, `${s.clientName} · ${sessionWho(s).short}`])),
    me,
  })
  if (!open) return <FilterRail filter={state.filter} count={picked.length} />
  const folds: Folds = { folded, toggle: toggleFold }
  const summary = (field: FilterField) => picked.filter((p) => p.field === field).map((p) => p.name)
  // Real tasks only: one still being created has no number yet.
  const tasks = projectTasks(board, workspaceId, project.id).filter((t) => t.number > 0)
  const ctx = matchContext(board, { projectId: project.id }, now)
  const props: PanelProps = { state, board, tasks, ctx, folds }
  const shown = state.active ? applyFilter(tasks, state.filter, ctx).length : tasks.length

  return (
    <aside
      aria-label="Filters"
      data-facets
      // Wider while sessions are listed, so their names and presence fit.
      className={`hidden shrink-0 flex-col gap-3 overflow-y-auto border-r border-line px-3 pt-1 pb-4 md:flex ${sessionsOpen ? "w-66" : "w-60"}`}
    >
      <div className="flex h-7 shrink-0 items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted tabular-nums" data-filter-result>
          {state.active ? `${shown} of ${tasks.length} tasks` : `${tasks.length} tasks`}
        </span>
        <span className="flex items-center gap-1">
          {state.active ? (
            <Button variant="ghost" size="sm" onClick={state.clear}>
              Clear all
            </Button>
          ) : null}
          <HidePanelButton />
        </span>
      </div>
      <TextFilter state={state} />
      <Section name="Label" field="labels" filter={state.filter} folds={folds} summary={summary("labels")}>
        <LabelFacet props={props} labels={labels} />
      </Section>
      <Section name="Working on it" field="holder" filter={state.filter} folds={folds} summary={summary("holder")}>
        <WhoFacet props={props} me={me} open={sessionsOpen} onOpen={setSessionsOpen} now={now} />
      </Section>
      <Section name="Priority" field="priority" filter={state.filter} folds={folds} summary={summary("priority")}>
        {([1, 2, 3, 4, 0] as Priority[]).map((p) => (
          <Value key={p} props={props} field="priority" id={`priority-${p}`} name={PRIORITY_LABELS[p]} icon={<PriorityIcon priority={p} />}
            checked={on(state.filter.priority.includes(p))} toggle={(f) => ({ ...f, priority: toggled(f.priority, p) })} probe={{ priority: [p] }} />
        ))}
      </Section>
      <Section name="Waiting on you" field="waiting" filter={state.filter} folds={folds} summary={summary("waiting")}>
        {WAITING.map((w) => (
          <Value key={w.id} props={props} field="waiting" id={`waiting-${w.id}`} name={w.name} icon={w.icon}
            checked={on(state.filter.waiting.includes(w.id))} toggle={(f) => ({ ...f, waiting: toggled(f.waiting, w.id) })} probe={{ waiting: [w.id] }} />
        ))}
      </Section>
      <Section name="Created by" field="maker" filter={state.filter} folds={folds} summary={summary("maker")}>
        {(["agent", "human"] as Maker[]).map((m) => (
          <Value key={m} props={props} field="maker" id={`by-${m}`} name={m === "agent" ? "An agent" : me}
            icon={m === "agent" ? <BotIcon aria-hidden className={icon} /> : <UserIcon aria-hidden className={icon} />}
            checked={on(state.filter.maker.includes(m))} toggle={(f) => ({ ...f, maker: toggled(f.maker, m) })} probe={{ maker: [m] }} />
        ))}
      </Section>
      <Section name="Due date" field="due" filter={state.filter} folds={folds} summary={summary("due")}>
        {DUE.map((d) => (
          <Value key={d.id} props={props} field="due" id={`due-${d.id}`} name={d.name} icon={d.icon}
            checked={on(state.filter.due.includes(d.id))} toggle={(f) => ({ ...f, due: toggled(f.due, d.id) })} probe={{ due: [d.id] }} />
        ))}
      </Section>
      <Section name="Updated" field="updated" filter={state.filter} folds={folds} summary={summary("updated")}>
        {UPDATED.map((u) => (
          <Value key={u.id} props={props} field="updated" id={`updated-${u.id}`} name={u.name} icon={<ClockIcon aria-hidden className={icon} />}
            checked={on(state.filter.updated === u.id)} toggle={(f) => ({ ...f, updated: f.updated === u.id ? null : u.id })} probe={{ updated: u.id }} />
        ))}
      </Section>
    </aside>
  )
}

const WAITING: ReadonlyArray<{ id: Waiting; name: string; icon: ReactNode }> = [
  { id: "review", name: "Open review packet", icon: <FileCheckIcon aria-hidden className={icon} /> },
  { id: "input", name: "Needs your input", icon: <MessageCircleQuestionIcon aria-hidden className={icon} /> },
]
const DUE: ReadonlyArray<{ id: Due; name: string; icon: ReactNode }> = [
  { id: "overdue", name: "Overdue", icon: <CalendarClockIcon aria-hidden className="size-3.5 shrink-0 text-danger" /> },
  { id: "week", name: "Due this week", icon: <CalendarIcon aria-hidden className={icon} /> },
  { id: "none", name: "No due date", icon: <CircleDashedIcon aria-hidden className={icon} /> },
]
const UPDATED: ReadonlyArray<{ id: Updated; name: string }> = [
  { id: "day", name: "In the last 24 hours" },
  { id: "week", name: "In the last 7 days" },
]

/**
 * The text box. While you type, what you typed is what it shows, and each change goes out to the
 * filter (URL and the kept copy); the URL catches up a moment later, so showing it instead would snap
 * the text back and move the caret. Once you leave the box it shows the filter again, so Clear all
 * and a link reach it.
 */
function TextFilter({ state }: { state: FilterState }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <SearchInput
      aria-label="Filter by text"
      placeholder="Filter by text…"
      size="sm"
      value={draft ?? state.filter.text}
      onFocus={() => setDraft(state.filter.text)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const text = e.currentTarget.value
        setDraft(text)
        state.patch({ text })
      }}
    />
  )
}

/**
 * A property's heading and its values. The heading reads darker while it filters, and folds the values
 * away (kept on this device); folded, it still names what's picked.
 */
function Section({ name, field, filter, folds, summary, children }: {
  name: string
  field: FilterField
  filter: TaskFilter
  folds: Folds
  summary: ReadonlyArray<string>
  children: ReactNode
}) {
  const tone = isActive(filter, field) ? "text-ink" : "text-muted"
  const folded = folds.folded.includes(field)
  return (
    <section aria-label={name} data-facet={field} data-folded={folded ? "" : undefined} className="flex shrink-0 flex-col gap-0.5">
      <h3>
        <FoldHeading name={name} folded={folded} summary={summary} tone={tone} onToggle={() => folds.toggle(field)} size="section" />
      </h3>
      {folded ? null : children}
    </section>
  )
}

/**
 * A heading that folds what's under it. Folded, it still says what's picked there ("Area  agents"), so
 * a folded section never hides a filter.
 */
function FoldHeading({ name, folded, summary, tone, onToggle, size }: {
  name: string
  folded: boolean
  summary: ReadonlyArray<string>
  tone: string
  onToggle: () => void
  size: "section" | "group"
}) {
  return (
    <button
      type="button"
      aria-expanded={!folded}
      data-fold={name}
      onClick={onToggle}
      className={`flex h-6 w-full min-w-0 items-center gap-1 rounded-md px-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring ${size === "section" ? `text-xs font-medium ${tone}` : "text-[11px] tracking-wide text-faint uppercase"}`}
    >
      <ChevronDownIcon aria-hidden className={`size-3 shrink-0 text-faint ${folded ? "-rotate-90" : ""}`} />
      <span className="shrink-0">{name}</span>
      {folded && summary.length > 0 ? (
        <span className="ml-auto min-w-0 truncate pl-2 text-xs font-normal tracking-normal text-ink normal-case" data-fold-summary>
          {summary.join(", ")}
        </span>
      ) : null}
    </button>
  )
}

/** One value of a property other than labels, counted with the other filters on. */
function Value({ props, field, id, name, icon: shownIcon, checked, toggle, probe }: {
  props: PanelProps
  field: Exclude<FilterField, "labels">
  id: string
  name: string
  icon: ReactNode
  checked: Checked
  toggle: (f: TaskFilter) => TaskFilter
  probe: Partial<TaskFilter>
}) {
  const { state, tasks, ctx } = props
  return (
    <FacetOption id={id} name={name} icon={shownIcon} checked={checked} count={countWith(tasks, state.filter, ctx, field, probe)} onToggle={() => state.set(toggle(state.filter))} />
  )
}

const dot = (color: string) => <i aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />

/** Labels in their groups: Kind, Area (the busiest 6, then Show all), Milestone, Other. */
function LabelFacet({ props, labels }: { props: PanelProps; labels: ReadonlyArray<Label> }) {
  const { state, tasks, ctx, folds } = props
  const [showAll, setShowAll] = useState(false)
  const picked = state.filter.labels
  const sections = labelSections(labels, tasks, picked, showAll)
  if (sections.length === 0) return <p className="px-2 text-xs text-faint">No labels yet</p>
  return (
    <>
      {sections.map((section) => (
        <div key={section.group} className="flex flex-col" data-label-group={section.group}>
          {section.heading ? (
            <FoldHeading
              name={section.heading}
              folded={folds.folded.includes(groupKey(section.group))}
              summary={section.rows.filter((l) => picked.includes(l.name.toLowerCase())).map((l) => l.name)}
              tone=""
              onToggle={() => folds.toggle(groupKey(section.group))}
              size="group"
            />
          ) : null}
          {folds.folded.includes(groupKey(section.group)) ? null : section.rows.map((l) => {
            const name = l.name.toLowerCase()
            return (
              <FacetOption key={l.id} id={`label-${name}`} name={l.name} icon={dot(l.color)} checked={on(picked.includes(name))}
                count={labelCount(tasks, state.filter, ctx, name)} onToggle={() => state.patch({ labels: toggled(picked, name) })} />
            )
          })}
          {section.group === "area" && section.size > TOP_AREAS && !folds.folded.includes(groupKey("area")) ? (
            <Button variant="more" size="row" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
              <ChevronDownIcon aria-hidden className={`size-3.5 ${showAll ? "rotate-180" : ""}`} />
              {showAll ? "Show fewer" : `Show all ${section.size}`}
            </Button>
          ) : null}
        </div>
      ))}
    </>
  )
}

/** An agent (opening into the sessions holding claims), Lucas, Nobody. */
function WhoFacet({ props, me, open, onOpen, now }: { props: PanelProps; me: string; open: boolean; onOpen: (open: boolean) => void; now: number }) {
  const { state, board, tasks, ctx } = props
  const f = state.filter
  const sessions = claimSessions(board, tasks, f.sessions, now)
  const listed = sessions.map((s) => s.id)
  const agent = agentBox(f)
  const live = sessions.filter((s) => presenceOf(s, now) === "active").length
  return (
    <>
      <div className="flex items-center">
        <span className="min-w-0 flex-1">
          <FacetOption
            id="who-agent"
            name="An agent"
            icon={<BotIcon aria-hidden className={icon} />}
            checked={agent}
            count={countWith(tasks, f, ctx, "holder", { holder: ["agent"], sessions: [] })}
            onToggle={() => state.set(toggleAgent(f))}
            after={sessions.length ? <SessionDots sessions={sessions} now={now} live={live} /> : undefined}
          />
        </span>
        {sessions.length ? (
          <Button variant="ghost" size="icon" aria-label={open ? "Hide agent sessions" : "Show agent sessions"} aria-expanded={open} onClick={() => onOpen(!open)}>
            <ChevronDownIcon aria-hidden className={`size-3.5 ${open ? "" : "-rotate-90"}`} />
          </Button>
        ) : null}
      </div>
      {open
        ? sessions.map((s) => {
          const who = sessionWho(s)
          const presence = presenceOf(s, now)
          return (
            <FacetOption
              key={s.id}
              id={`session-${who.short}`}
              name={`${s.clientName} · ${who.short}`}
              nested
              icon={<span className="flex size-3.5 shrink-0 items-center justify-center"><PresenceDot of={s} color={who.color} /></span>}
              detail={{ text: presenceWords(s, now), tone: presence }}
              checked={on(agent === "on" || f.sessions.includes(s.id))}
              count={countWith(tasks, f, ctx, "holder", { holder: [], sessions: [s.id] })}
              onToggle={() => state.set(toggleSession(f, s.id, listed))}
            />
          )
        })
        : null}
      {(["human", "nobody"] as const).map((h) => (
        <Value key={h} props={props} field="holder" id={`who-${h}`} name={h === "human" ? me : "Nobody"}
          icon={h === "human" ? <UserIcon aria-hidden className={icon} /> : <CircleDashedIcon aria-hidden className={icon} />}
          checked={on(f.holder.includes(h))} toggle={(x) => ({ ...x, holder: toggled(x.holder, h) })} probe={{ holder: [h], sessions: [] }} />
      ))}
    </>
  )
}

/** One small dot per session holding a claim, so the closed "An agent" row still says who's working. */
function SessionDots({ sessions, now, live }: { sessions: ReturnType<typeof claimSessions>; now: number; live: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[3px]" title={`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}, ${live} active`} data-session-dots={live}>
      {sessions.map((s) => {
        const presence = presenceOf(s, now)
        return (
          <i
            key={s.id}
            aria-hidden
            className={`size-1.5 rounded-full ${presence === "active" ? "" : presence === "idle" ? "border border-idle" : "border border-faint"}`}
            style={presence === "active" ? { background: sessionWho(s).color } : undefined}
          />
        )
      })}
    </span>
  )
}
