import { type Label, LABEL_GROUP_NAMES, LABEL_GROUPS, type LabelGroup, type Project } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { ArchiveIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { ColorPicker, PALETTE } from "../components/ui/ColorPicker.tsx"
import { Input } from "../components/ui/Input.tsx"
import { Select } from "../components/ui/Select.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard } from "../lib/hooks.ts"
import { NameField } from "./NameField.tsx"

/** A project's labels (CEL-80): the new-label form and the list, archived ones left out. */
export function ProjectLabels({ project }: { project: Project }) {
  const board = useBoard()
  if (!board) return null
  const labels = Object.values(board.labels)
    .filter((l) => l.projectId === project.id && l.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <NewLabel projectId={project.id} />
      <ul aria-label="Labels" className="divide-y divide-line rounded-lg border border-line empty:hidden">
        {labels.map((l) => (
          <LabelRow key={l.id} label={l} />
        ))}
      </ul>
    </>
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
