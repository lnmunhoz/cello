import { buildLine, buildParts } from "@cello/shared/build"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/Popover.tsx"
import { useServerBuild } from "../lib/build.ts"
import { Linkified } from "../viewer/ViewerLink.tsx"

/**
 * The running build at the foot of the sidebar (CEL-37): "Cello 0.2.0 · build c602f25", then "live since
 * 18:19". A click lists what changed since the previous build: the merged commits, with their task keys.
 */
export function BuildFooter() {
  const build = useServerBuild()
  if (build === null) return null
  // The server's own commit; one run from a folder without git still names its web build's.
  const running = { ...build, commit: build.commit ?? build.web?.commit ?? null }
  const now = Date.now()
  const { name, since } = buildParts(running, now)
  const changes = build.web?.changes ?? []
  return (
    <Popover>
      <PopoverTrigger variant="footer" aria-label={`${buildLine(running, now)}. What changed in this build`} data-build-footer>
        <span className="truncate">{name}</span>
        <span className="truncate">{since}</span>
      </PopoverTrigger>
      <PopoverContent side="top">
        <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-1">
          <h2 className="text-xs font-medium text-muted">What changed since the previous build</h2>
          {changes.length > 0 ? (
            <ul aria-label="Changes in this build" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-[13px] leading-snug text-ink">
              {changes.map((subject, i) => (
                <li key={i}>
                  <Linkified text={subject} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No list of changes for this build.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
