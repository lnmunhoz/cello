import type { Options } from "react-markdown"
import remarkGfm from "remark-gfm"
import { linkifyTasks } from "../../task/TaskKey.tsx"
import { remarkLinkify } from "./remarkLinkify.ts"

/**
 * How Cello reads markdown, everywhere it shows some (comments, descriptions, packets, asks, an
 * agent's log, pages): GitHub-flavored (tables, task lists, strikethrough, autolinks), then bare web
 * addresses and the task keys of `projectKeys` ("CEL THAI") as links.
 */
export const remarkPlugins = (projectKeys: string | undefined): NonNullable<Options["remarkPlugins"]> => [
  remarkGfm,
  [remarkLinkify, linkifyTasks(projectKeys)],
]
