// Every error a command can end with, as one sentence that says what to do next. One table, keyed
// by error tag; commands fail with CliFailure carrying that sentence.
import * as Data from "effect/Data"
import { ago, shortSession } from "./format.ts"

/** A command's failure, already explained. `cello` prints the message to stderr and exits 1. */
export class CliFailure extends Data.TaggedError("CliFailure")<{ readonly message: string }> {}

type Tagged = { readonly _tag?: unknown } & Record<string, any>

export interface Where {
  readonly port: number
  readonly now: number
}

export const explain = (error: unknown, where: Where): string => {
  const e = (typeof error === "object" && error !== null ? error : {}) as Tagged
  switch (e._tag) {
    case "TaskClaimed": {
      if (e.sessionId === null) return `${e.key} is claimed by ${e.holder}. Pick another task or run \`cello task get ${e.key}\`.`
      const active = e.lastSeenAt === null || where.now - e.lastSeenAt < 60_000 ? "active now" : `active ${ago(e.lastSeenAt, where.now)}`
      return `${e.key} is claimed by ${e.holder} session ${shortSession(e.sessionId)} (${active}). Pick another task or run \`cello task get ${e.key}\`.`
    }
    case "NotFound":
      switch (e.entity) {
        case "task":
          return `No task ${e.id}. Run \`cello task list\` to see open tasks.`
        case "project":
          return String(e.id).startsWith("/")
            ? `No project is linked to ${e.id}. Pass --project KEY (\`cello init\` comes later in M2).`
            : `No project with key ${e.id}. Check the key, or run \`cello context\` inside a project's folder.`
        case "document":
          return `No document ${e.id}. Run \`cello doc list\` to see the project's documents.`
        case "document version": {
          const at = String(e.id).lastIndexOf("@")
          return `No version ${String(e.id).slice(at + 1)} of ${String(e.id).slice(0, at)}. Run \`cello doc list\` to see the project's documents.`
        }
        default:
          return `That ${e.entity} (${e.id}) no longer exists. Run \`cello context\` to see the current state.`
      }
    case "Invalid":
      return `${capitalize(String(e.reason))}.`
    case "VersionConflict":
      return `It was changed by ${e.changedBy} in the meantime. Run the command again.`
    case "ReviewRequired":
      return `${e.key} needs a review packet before it goes to ${e.status}. Submit one instead: ` +
        `\`cello task submit ${e.key} --summary "what changed" --step "how to check it" --attach demo.mp4\`. See \`cello guide\`.`
    case "HumanOnly":
      return `Only ${e.human} can ${e.action}. Leave the task in In Review; ${e.human} decides on the Review page.`
    case "RpcClientError":
      return `Cello isn't running on 127.0.0.1:${where.port}. Start it with \`cello start\`.`
    case "CliFailure":
      return String(e.message)
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
