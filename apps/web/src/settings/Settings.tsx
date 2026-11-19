import { placement, statusesOf } from "@cello/client/sync/selectors"
import type { Status } from "@cello/contract/entities"
import { buildLine } from "@cello/release/build"
import { useAtomSet } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon, LayoutListIcon, PanelRightIcon } from "lucide-react"
import { useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ColorPicker } from "../components/ui/ColorPicker.tsx"
import { Input } from "../components/ui/Input.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { runningBuild, useServerBuild } from "../lib/build.ts"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { writeStored } from "../lib/storage.ts"
import { BAR_LAYOUT_KEY, LAYOUT_NAMES, useBarLayout } from "../search/layout.ts"
import { useUpdateState } from "../updates/updates.ts"
import { BoardSettings, useDesktopBoard } from "./BoardSettings.tsx"
import { NameField } from "./NameField.tsx"
import { ReviewSettings } from "./ReviewSettings.tsx"
import { Section, SettingsColumn } from "./Section.tsx"
import { UpdateSettings } from "./UpdateSettings.tsx"

/** The settings that aren't a project's: its own are on the project's Settings tab (ProjectSettings). */
export function Settings() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  // Cello.app's updates (CEL-140) and its board (CEL-149); null in a browser.
  const updates = useUpdateState()
  const desktopBoard = useDesktopBoard()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  const statuses = statusesOf(board, workspaceId)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Settings" }]} />
      <SettingsColumn>
        {/* First: which board this is. A switch lands here, on the board it switched to. */}
        {desktopBoard ? (
          <Section title="Board" description="The data folder and port this app's server uses. Kept in the app, not in the board.">
            <BoardSettings key={`${desktopBoard.dataDir}:${desktopBoard.port}`} state={desktopBoard} />
          </Section>
        ) : null}
        <Section title="Statuses" description="The board's columns, shared by every project in this workspace.">
          <ul aria-label="Statuses" className="divide-y divide-line rounded-lg border border-line">
            {statuses.map((s, i) => (
              <StatusRow key={s.id} status={s} statuses={statuses} index={i} />
            ))}
          </ul>
        </Section>
        <Section title="Workspaces" description="A second workspace adds a switcher at the top of the sidebar.">
          <NewWorkspace />
        </Section>
        <Section title="Search" description="How the ⌘K bar shows results on this device. Peek previews the highlighted result beside the list; in a narrow window it shows as Palette.">
          <SearchLayout />
        </Section>
        <Section title="Review" description="How the Review page sends your decisions, on this device.">
          <ReviewSettings />
        </Section>
        {updates ? (
          <Section title="Updates" description="How the Cello app finds new versions on GitHub, and which ones it offers.">
            <UpdateSettings state={updates} />
          </Section>
        ) : null}
        <Section title="Builds" description="Which build of Cello is running, and every build before it with what changed.">
          <RunningBuild />
        </Section>
      </SettingsColumn>
    </div>
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
