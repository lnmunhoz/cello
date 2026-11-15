import { FileXIcon } from "lucide-react"
import type { ReactNode } from "react"

/**
 * A link to a file on the publisher's machine that never reached Cello (CEL-54): its text, inert, with
 * a "missing file" tag. Following it would only reach a page that doesn't exist.
 */
export function MissingFile({ path, children }: { path: string; children: ReactNode }) {
  return (
    <span data-missing-file="" title={`${path} didn't go up with the page`} className="text-muted">
      <FileXIcon aria-hidden className="mr-1 inline-block size-[0.9em] align-[-0.1em] text-faint" />
      <span className="underline decoration-dotted underline-offset-2">{children}</span>
      <span className="ml-1.5 rounded bg-sunken px-1 py-px align-[0.1em] text-[0.72em] font-medium text-faint">missing file</span>
    </span>
  )
}
