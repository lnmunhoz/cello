// One sentence for a toast, from any error a command can fail with.
type Tagged = { readonly _tag?: unknown } & Record<string, unknown>

export const describeError = (error: unknown, options: { readonly subject?: string } = {}): string => {
  const e = (typeof error === "object" && error !== null ? error : {}) as Tagged
  switch (e._tag) {
    case "VersionConflict":
      return options.subject
        ? `${options.subject} was changed by ${String(e.changedBy)} since you opened it`
        : `Changed by ${String(e.changedBy)} since you opened it`
    case "KeyTaken":
      return `${String(e.key)} is used by ${String(e.projectName)}`
    case "NotFound":
      return `That ${String(e.entity)} no longer exists`
    case "Invalid":
      return String(e.reason)
    case "RpcClientError":
      return "Can't reach the Cello server"
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
}
