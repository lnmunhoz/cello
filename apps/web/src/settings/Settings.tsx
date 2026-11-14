import { placement, statusesOf } from "@cello/client/sync/selectors"
import type { Label, Status } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { ArrowDownIcon, ArrowUpIcon, ArchiveIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ColorPicker, PALETTE } from "../components/ui/ColorPicker.tsx"
import { Input } from "../components/ui/Input.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"

export function Settings() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  const statuses = statusesOf(board, workspaceId)
  const labels = Object.values(board.labels)
    .filter((l) => l.workspaceId === workspaceId && l.archivedAt === null)
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
          <Section title="Labels" description="Shared by every project in this workspace.">
            <NewLabel workspaceId={workspaceId} />
            <ul aria-label="Labels" className="divide-y divide-line rounded-lg border border-line empty:hidden">
              {labels.map((l) => (
                <LabelRow key={l.id} label={l} />
              ))}
            </ul>
          </Section>
          <Section title="Workspaces" description="A second workspace adds a switcher at the top of the sidebar.">
            <NewWorkspace />
          </Section>
        </div>
      </div>
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

function LabelRow({ label }: { label: Label }) {
  const update = useAtomSet(commands.updateLabel)
  const archive = useAtomSet(commands.archiveLabel)
  return (
    <li data-label-row={label.name} className="flex h-10 items-center gap-2 px-3">
      <ColorPicker label={`${label.name} color`} value={label.color} onChange={(color) => update({ id: label.id, color })} />
      <div className="flex-1">
        <NameField label={`${label.name} name`} value={label.name} onSave={(name) => update({ id: label.id, name })} />
      </div>
      <Button variant="ghost" size="icon" aria-label={`Archive ${label.name}`} onClick={() => archive({ id: label.id })}>
        <ArchiveIcon className="size-3.5" />
      </Button>
    </li>
  )
}

function NewLabel({ workspaceId }: { workspaceId: string }) {
  const create = useAtomSet(commands.createLabel)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(PALETTE[2])
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() === "") return
        create({ workspaceId, name: name.trim(), color })
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
