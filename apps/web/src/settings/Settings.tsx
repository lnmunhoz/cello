import { placement, projectsOf, statusesOf } from "@cello/client/sync/selectors"
import { type Label, LABEL_GROUP_NAMES, LABEL_GROUPS, type LabelGroup, type Project, type Status } from "@cello/contract/entities"
import { buildLine } from "@cello/shared/build"
import { useAtomSet } from "@effect/atom-react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowDownIcon, ArrowUpIcon, ArchiveIcon, EyeIcon, EyeOffIcon, LayoutListIcon, PanelRightIcon } from "lucide-react"
import { useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ColorPicker, PALETTE } from "../components/ui/ColorPicker.tsx"
import { Input } from "../components/ui/Input.tsx"
import { Select } from "../components/ui/Select.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { runningBuild, useServerBuild } from "../lib/build.ts"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { writeStored } from "../lib/storage.ts"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { BAR_LAYOUT_KEY, LAYOUT_NAMES, useBarLayout } from "../search/layout.ts"
import { useUpdateState } from "../updates/updates.ts"
import { TestingProfile } from "./TestingProfile.tsx"
import { UpdateSettings } from "./UpdateSettings.tsx"
import { WakeSettings } from "./WakeSettings.tsx"

/** `/settings?project=THAI`: whose labels the Labels section shows (CEL-80). */
export interface SettingsSearch {
  readonly project?: string
}

export const parseSettingsSearch = (search: Record<string, unknown>): SettingsSearch => {
  const project = search["project"]
  return typeof project === "string" && project.trim() !== "" ? { project: project.trim().toUpperCase() } : {}
}

export function Settings() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const search = useSearch({ from: "/settings" })
  // Cello.app's updates (CEL-140); null in a browser.
  const updates = useUpdateState()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  const statuses = statusesOf(board, workspaceId)
  // Labels belong to a project (CEL-80): the one in the URL, else the first.
  const projects = projectsOf(board, workspaceId)
  const project = projects.find((p) => p.key === search.project) ?? projects[0]
  const labels = Object.values(board.labels)
    .filter((l) => l.projectId === project?.id && l.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Settings" }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-10">
          <Section title="Statuses" description="The board's columns, shared by every project in this workspace.">
            <ul aria-label="Statuses" className="divide-y divide-line rounded-lg border border-line">
              {statuses.map((s, i) => (
                <StatusRow key={s.id} status={s} statuses={statuses} index={i} />
              ))}
            </ul>
          </Section>
          <Section title="Labels" description="Each project has its own labels: its kinds, areas and milestones.">
            {project ? (
              <>
                <ProjectPicker label="Labels of project" projectId={project.id} projects={projects} />
                <NewLabel projectId={project.id} />
                <ul aria-label="Labels" className="divide-y divide-line rounded-lg border border-line empty:hidden">
                  {labels.map((l) => (
                    <LabelRow key={l.id} label={l} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] text-muted">Labels belong to a project: make a project first.</p>
            )}
          </Section>
          {project ? (
            <Section
              title="Testing"
              description={`How agents test ${project.name} and collect evidence for review. cello init drafts it from the repo and agents fix it when the repo changes; what you set here, agents can't change.`}
            >
              <ProjectPicker label="Testing profile of project" projectId={project.id} projects={projects} />
              <TestingProfile key={project.key} projectKey={project.key} />
            </Section>
          ) : null}
          {project ? (
            <Section
              title="Waking agents"
              description={`Whether Cello starts ${project.name}'s agent sessions by itself when you act on a task they claimed and nothing of them is running.`}
            >
              <ProjectPicker label="Waking agents of project" projectId={project.id} projects={projects} />
              <WakeSettings key={project.key} projectKey={project.key} />
            </Section>
          ) : null}
          <Section title="Workspaces" description="A second workspace adds a switcher at the top of the sidebar.">
            <NewWorkspace />
          </Section>
          <Section title="Search" description="How the ⌘K bar shows results on this device. Peek previews the highlighted result beside the list; in a narrow window it shows as Palette.">
            <SearchLayout />
          </Section>
          {updates ? (
            <Section title="Updates" description="How the Cello app finds new versions on GitHub, and which ones it offers.">
              <UpdateSettings state={updates} />
            </Section>
          ) : null}
          <Section title="Builds" description="Which build of Cello is running, and every build before it with what changed.">
            <RunningBuild />
          </Section>
        </div>
      </div>
    </div>
  )
}

/** Which project a per-project section shows (labels, the testing profile), kept in the URL. */
function ProjectPicker({ label, projectId, projects }: { label: string; projectId: string; projects: ReadonlyArray<Project> }) {
  const navigate = useNavigate()
  return (
    <div className="max-w-xs">
      <Select
        variant="boxed"
        label={label}
        value={projectId}
        options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.key})` }))}
        onValueChange={(id) => {
          const picked = projects.find((p) => p.id === id)
          if (picked) void navigate({ to: "/settings", search: { project: picked.key }, replace: true })
        }}
      />
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** A text field that saves on blur or Enter, and shows the stored value otherwise. */
function NameField({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== value) onSave(draft.trim())
    setDraft(null)
  }
  return (
    <Input
      variant="bare"
      size="sm"
      aria-label={label}
      {...SAVES_ON_BLUR}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function StatusRow({ status, statuses, index }: { status: Status; statuses: ReadonlyArray<Status>; index: number }) {
  const update = useAtomSet(commands.updateStatus)
  const moveTo = (to: number) => {
    const others = statuses.filter((s) => s.id !== status.id)
    update({ id: status.id, ...placement(others, to) })
  }
  return (
    <li data-status-row={status.name} className="flex h-10 items-center gap-2 px-3">
      <StatusIcon category={status.category} color={status.color} />
      <ColorPicker label={`${status.name} color`} value={status.color} onChange={(color) => update({ id: status.id, color })} />
      <div className="flex-1">
        <NameField label={`${status.name} name`} value={status.name} onSave={(name) => update({ id: status.id, name })} />
      </div>
      {status.hidden ? <span className="text-xs text-faint">Hidden</span> : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label={status.hidden ? `Show ${status.name}` : `Hide ${status.name}`}
        onClick={() => update({ id: status.id, hidden: !status.hidden })}
      >
        {status.hidden ? <EyeIcon className="size-3.5" /> : <EyeOffIcon className="size-3.5" />}
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Move ${status.name} up`} disabled={index === 0} onClick={() => moveTo(index - 1)}>
        <ArrowUpIcon className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Move ${status.name} down`} disabled={index === statuses.length - 1} onClick={() => moveTo(index + 1)}>
        <ArrowDownIcon className="size-3.5" />
      </Button>
    </li>
  )
}

const GROUP_OPTIONS = LABEL_GROUPS.map((value) => ({ value, label: LABEL_GROUP_NAMES[value] }))

function LabelRow({ label }: { label: Label }) {
  const update = useAtomSet(commands.updateLabel)
  const archive = useAtomSet(commands.archiveLabel)
  return (
    <li data-label-row={label.name} className="flex h-10 items-center gap-2 px-3">
      <ColorPicker label={`${label.name} color`} value={label.color} onChange={(color) => update({ id: label.id, color })} />
      <div className="flex-1">
        <NameField label={`${label.name} name`} value={label.name} onSave={(name) => update({ id: label.id, name })} />
      </div>
      {/* The group the Issues tab's filter lists it under (CEL-52). */}
      <Select
        variant="chip"
        label={`${label.name} group`}
        value={label.group}
        options={GROUP_OPTIONS}
        onValueChange={(group) => group && update({ id: label.id, group: group as LabelGroup })}
      />
      <Button variant="ghost" size="icon" aria-label={`Archive ${label.name}`} onClick={() => archive({ id: label.id })}>
        <ArchiveIcon className="size-3.5" />
      </Button>
    </li>
  )
}

function NewLabel({ projectId }: { projectId: string }) {
  const create = useAtomSet(commands.createLabel)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(PALETTE[2])
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() === "") return
        create({ projectId, name: name.trim(), color })
        setName("")
      }}
    >
      <ColorPicker label="New label color" value={color} onChange={setColor} />
      <div className="flex-1">
        <Input aria-label="New label name" placeholder="New label" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </div>
      <Button type="submit">Add label</Button>
    </form>
  )
}

/** The ⌘K bar's layout (CEL-43), the same choice as the bar's footer. */
function SearchLayout() {
  const layout = useBarLayout()
  return (
    <div className="flex items-center gap-3">
      <SegmentedControl aria-label="Search layout" value={layout} onValueChange={(value) => value && writeStored(BAR_LAYOUT_KEY, String(value))}>
        {(["peek", "palette"] as const).map((l) => (
          <SegmentedControlItem key={l} value={l}>
            {l === "peek" ? <PanelRightIcon aria-hidden className="size-3.5" /> : <LayoutListIcon aria-hidden className="size-3.5" />}
            {LAYOUT_NAMES[l]}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <span className="text-[13px] text-muted">{layout === "peek" ? "The results, and a preview of the highlighted one." : "Centred, one line per result."}</span>
    </div>
  )
}

function RunningBuild() {
  const build = useServerBuild()
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-muted tabular-nums">
        {build ? buildLine(runningBuild(build), Date.now()) : "Asking the server…"}
      </span>
      <Link to="/builds" className="shrink-0 font-medium text-ink hover:underline">
        See all builds →
      </Link>
    </div>
  )
}

function NewWorkspace() {
  const create = useAtomSet(commands.createWorkspace)
  const [name, setName] = useState("")
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() === "") return
        create({ name: name.trim() })
        setName("")
      }}
    >
      <div className="flex-1">
        <Input aria-label="New workspace name" placeholder="New workspace" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </div>
      <Button type="submit">Create workspace</Button>
    </form>
  )
}
