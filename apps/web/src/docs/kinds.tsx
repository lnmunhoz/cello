import type { DocumentKind } from "@cello/contract/entities"
import { BookOpenIcon, FileTextIcon, PencilRulerIcon } from "lucide-react"

export const KIND_LABELS: Record<DocumentKind, string> = { doc: "Doc", spec: "Spec", page: "Page" }

const ICONS = { doc: BookOpenIcon, spec: PencilRulerIcon, page: FileTextIcon } as const

/** A document's kind as a small icon in a tile. */
export function KindIcon({ kind }: { kind: DocumentKind }) {
  const Icon = ICONS[kind]
  return (
    <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted">
      <Icon className="size-3.5" />
    </span>
  )
}
