import { Fragment } from "react"
import { type AuthorPart, authorParts, type Who } from "./model.ts"

const LOOK: Record<AuthorPart["kind"], string> = {
  name: "font-medium text-ink",
  role: "text-muted",
  session: "text-faint",
  model: "font-medium text-ink",
  effort: "text-faint",
}

/**
 * Who wrote something, and as what (CEL-119), the same in a comment, the presence line and the Agents
 * page: "Claude Code · Main session · Opus 5.5 · high · 2fd0505c", "cello-builder · Subagent of 2fd0505c ·
 * Sonnet 5.5 · medium". The session id's hover names the session in full. `name`: what it leads with
 * instead of the client or type ("cello-builder · a13bfb89" where two builders sit side by side).
 */
export function Author({ who, name }: { who: Who; name?: string | undefined }) {
  const parts = authorParts(who)
  return (
    <span className="min-w-0 truncate" data-author-role={who.role} data-author-model={who.model ?? undefined}>
      {parts.map((part, i) => (
        <Fragment key={part.kind}>
          {/* "Subagent of " runs into its session; every other part is set off by a dot. */}
          {i > 0 && parts[i - 1]!.text.endsWith(" ") === false ? <span className="text-faint"> · </span> : null}
          <span className={LOOK[part.kind]} title={part.title} data-author-part={part.kind}>
            {part.kind === "name" && name !== undefined ? name : part.text}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
