// Where an agent session runs (CEL-137), as a small chip: Terminal (· WezTerm), Claude desktop, IDE,
// Agent SDK app, or Woken by Cello while Cello runs it. The words are @cello/shared/origin's, the same
// as `cello agents`; the hover adds when Cello last woke it.
import type { AgentSession } from "@cello/contract/entities"
import { type OriginKind, originOf, originText } from "@cello/shared/origin"
import { AlarmClockIcon, BlocksIcon, CodeIcon, type LucideIcon, MonitorIcon, SquareTerminalIcon, TerminalIcon } from "lucide-react"
import { Chip } from "../components/ui/Chip.tsx"
import { useNow } from "./useNow.ts"

const ICONS: Record<OriginKind, LucideIcon> = {
  terminal: TerminalIcon,
  desktop: MonitorIcon,
  ide: CodeIcon,
  sdk: BlocksIcon,
  headless: SquareTerminalIcon,
  woken: AlarmClockIcon,
  other: SquareTerminalIcon,
}

export function OriginBadge({ session }: { session: AgentSession }) {
  const now = useNow()
  const origin = originOf(session)
  if (origin === null) return null
  const Icon = ICONS[origin.kind]
  return (
    <span className="inline-flex min-w-0 shrink-0" data-origin={origin.kind} title={originText(session, now) ?? undefined}>
      <Chip size="sm" icon={<Icon aria-hidden className={`size-3 shrink-0 ${origin.kind === "woken" ? "text-accent" : ""}`} />}>
        {origin.label}
      </Chip>
    </span>
  )
}
