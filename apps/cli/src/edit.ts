// `cello task edit` (CEL-63): the pure part, turning its flags into task.update's fields. Priorities by
// name are read here for `task create` too.
import type { Priority } from "@cello/contract/entities"

const PRIORITIES: Record<string, Priority> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4 }

/** A priority by name (any case) or number; a string is the reason it can't be read. */
export const priorityOf = (value: string): Priority | string =>
  PRIORITIES[value.trim().toLowerCase()] ?? `No priority "${value}". Use urgent, high, medium, low or none.`

export interface EditFields {
  readonly title?: string
  readonly description?: string
  readonly priority?: Priority
}

/** The fields `task edit` changes; a string is why it can't (nothing given, an unknown priority). */
export const editFields = (
  key: string,
  input: {
    readonly title?: string | undefined
    readonly description?: string | undefined
    readonly priority?: string | undefined
    /** `--milestone` (CEL-113): changed with its own call, so it only counts as something to change here. */
    readonly milestone?: string | undefined
  },
): EditFields | string => {
  if (input.title === undefined && input.description === undefined && input.priority === undefined && input.milestone === undefined) {
    return `Say what to change: cello task edit ${key.toUpperCase()} --title "…", --description "…" ` +
      "(or --body-file - for markdown from stdin), --priority high, or --milestone M3."
  }
  const priority = input.priority === undefined ? undefined : priorityOf(input.priority)
  if (typeof priority === "string") return priority
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(priority === undefined ? {} : { priority }),
  }
}
