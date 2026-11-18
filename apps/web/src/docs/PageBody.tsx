import type { DocumentFile } from "@cello/contract/entities"
import { referenceDefinitions, splitSections } from "@cello/text/document"
import { Prose } from "./Prose.tsx"

/** Sections a republish changed, flashed in the publisher's color until their animation ends. */
export interface Flash {
  readonly version: number
  readonly color: string
  readonly ids: ReadonlyArray<string>
}

/**
 * A page's content, one `<section>` per `##`/`###` heading (plus the intro), so a republish redraws
 * only what changed and a changed section can be flashed on its own. Link reference definitions go
 * to every section, so `[the PR][pr]` resolves wherever its definition sits. Task keys of
 * `projectKeys` ("CEL THAI") link to their task, each key reading its task's status from the board.
 */
export function PageBody({
  content,
  flash,
  onFlashEnd,
  projectKeys,
  files,
}: {
  content: string
  flash: Flash | null
  onFlashEnd: (id: string) => void
  projectKeys?: string | undefined
  /** The page's files: a link to one of its videos plays inline. */
  files?: ReadonlyArray<DocumentFile>
}) {
  const references = referenceDefinitions(content)
  const tail = references.length === 0 ? "" : `\n\n${references.join("\n")}`
  return (
    // One gallery: ← and → in the image modal step through every section's images and diagrams.
    <div className="page-prose" data-gallery="">
      {splitSections(content).map((block) => {
        const changed = flash !== null && flash.ids.includes(block.id)
        return (
          <section key={block.id} data-section={block.id} data-changed={changed ? "" : undefined}>
            {changed ? (
              <span
                key={flash.version}
                className="page-flash"
                style={{ "--flash": flash.color } as React.CSSProperties}
                aria-hidden="true"
                onAnimationEnd={() => onFlashEnd(block.id)}
              />
            ) : null}
            <Prose markdown={block.markdown + tail} headingId={block.level === null ? undefined : block.id} projectKeys={projectKeys} files={files} />
          </section>
        )
      })}
    </div>
  )
}
