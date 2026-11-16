// Settings' Testing section (CEL-89): the project's testing profile, how agents test its repo and
// collect evidence. Each field shows where its value came from; what Lucas sets here is his, and agents
// can't change it (they ask on the card).
import { DEFAULT_UI_RUNS_IN, e2eField, UI_RUNS_IN } from "@cello/shared/testingProfile"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { Input } from "../components/ui/Input.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { commands, profileFamily } from "../lib/cello.ts"
import { SAVES_ON_BLUR } from "../lib/editing.ts"
import { type ProfileRow, profileRows, sourceText } from "./profileRows.ts"

export function TestingProfile({ projectKey }: { projectKey: string }) {
  const result = useAtomValue(profileFamily(projectKey))
  const setProfile = useAtomSet(commands.setProfile)
  // Surfaces added here, shown with empty fields until one is saved.
  const [added, setAdded] = useState<ReadonlyArray<string>>([])
  if (!AsyncResult.isSuccess(result)) return <p className="text-[13px] text-muted">Loading the testing profile…</p>
  const rows = profileRows(result.value.fields, added)
  const save = (field: string, value: string | null) =>
    setProfile(value === null ? { projectKey, set: [], unset: [field] } : { projectKey, set: [{ field, value }] })
  return (
    <>
      <ul aria-label="Testing profile" className="divide-y divide-line rounded-lg border border-line">
        {rows.flatMap((row, i) => [
          ...(row.surface !== null && rows[i - 1]?.surface !== row.surface
            ? [
              <li key={`surface:${row.surface}`} className="px-3 pt-3 pb-1 text-[13px] font-medium">
                {row.surface} e2e
              </li>,
            ]
            : []),
          <li key={row.field} data-profile-row={row.field} className="flex min-h-10 items-center gap-3 px-3 py-1">
            <span className="w-44 shrink-0 text-[13px] text-muted">{row.rowLabel}</span>
            <div className="min-w-0 flex-1">
              {row.field === "ui.runsIn" ? <RunsIn row={row} onSave={save} /> : <ValueField row={row} onSave={save} />}
            </div>
            {row.source !== null && row.updatedAt !== null ? (
              <Chip size="sm">{sourceText({ source: row.source, updatedAt: row.updatedAt })}</Chip>
            ) : row.field === "ui.runsIn" ? <Chip size="sm">Default</Chip> : null}
          </li>,
        ])}
      </ul>
      <NewSurface onAdd={(surface) => setAdded([...added, surface])} />
    </>
  )
}

/** A value that saves on blur or Enter; clearing it unsets the field. */
function ValueField({ row, onSave }: { row: ProfileRow; onSave: (field: string, value: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const stored = row.value ?? ""
  const save = () => {
    if (draft !== null && draft.trim() !== stored) onSave(row.field, draft.trim() === "" ? null : draft.trim())
    setDraft(null)
  }
  return (
    <Input
      variant="bare"
      size="sm"
      aria-label={row.label}
      placeholder="Not set"
      {...SAVES_ON_BLUR}
      value={draft ?? stored}
      onFocus={() => setDraft(stored)}
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

function RunsIn({ row, onSave }: { row: ProfileRow; onSave: (field: string, value: string | null) => void }) {
  return (
    <div className="w-fit">
      <SegmentedControl
        aria-label={row.label}
        value={row.value ?? DEFAULT_UI_RUNS_IN}
        onValueChange={(value) => value && value !== row.value && onSave(row.field, String(value))}
      >
        {UI_RUNS_IN.map((where) => (
          <SegmentedControlItem key={where} value={where}>
            {where === "local" ? "Local (headless)" : "Docker"}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )
}

function NewSurface({ onAdd }: { onAdd: (surface: string) => void }) {
  const [name, setName] = useState("")
  const surface = name.trim().toLowerCase()
  const valid = e2eField(`e2e.${surface}.run`) !== null
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onAdd(surface)
        setName("")
      }}
    >
      <div className="flex-1">
        <Input aria-label="New e2e surface" placeholder="Another e2e surface: desktop, mobile…" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </div>
      <Button type="submit" disabled={!valid}>Add surface</Button>
    </form>
  )
}
