import { useState } from "react"
import { Input } from "../components/ui/Input.tsx"
import { SAVES_ON_BLUR } from "../lib/editing.ts"

/** A text field that saves on blur or Enter, and shows the stored value otherwise. */
export function NameField({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => void }) {
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
