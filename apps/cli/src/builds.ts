// `cello builds` as text (CEL-50): each build on one line, newest first, the running one marked, and
// the commits merged since the build before it indented under it.
import type { BuildPage } from "@cello/contract/build"
import { liveFor, shortCommit } from "@cello/release/build"
import { columns, localTime } from "./format.ts"

export const buildsText = (page: BuildPage, now: number): string => {
  if (page.builds.length === 0) {
    return "No builds recorded yet. Cello records a build when `cello start` (or the desktop app) serves its web app; a dev server records none."
  }
  const heads = columns(page.builds.map((b) => [
    `#${b.number}`,
    `build ${shortCommit(b.commit)}`,
    `Cello ${b.version}`,
    `live since ${localTime(b.startedAt)}, for ${liveFor((b.liveUntil ?? now) - b.startedAt)}${b.id === page.running ? "  running" : ""}`,
  ]))
  const lines = page.builds.flatMap((b, i) => [
    heads[i]!,
    ...(b.changes.length > 0 ? b.changes.map((subject) => `    ${subject}`) : ["    no changes since the build before it"]),
  ])
  if (page.next !== null) lines.push(`Older builds: cello builds --before ${page.next}`)
  return lines.join("\n")
}
