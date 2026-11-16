// Every error a command can end with, as one sentence that says what to do next. One table, keyed
// by error tag; commands fail with CliFailure carrying that sentence.
import * as Data from "effect/Data"
import type { NotWokenReason } from "@cello/contract/entities"
import { NOT_WOKEN_TEXT } from "@cello/contract/wake"
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
            ? `No project is linked to ${e.id}. Run \`cello init\` to make this repo a Cello project, or pass --project KEY.`
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
    case "KeyTaken":
      return `The key ${e.key} is taken by ${e.projectName}. Pick another with --key, or leave --key out and Cello picks a free one.`
    case "VersionConflict":
      return `It was changed by ${e.changedBy} in the meantime. Run the command again.`
    case "ReviewRequired":
      return `${e.key} needs a review packet before it goes to ${e.status}. Submit one instead: ` +
        `\`cello task submit ${e.key} --summary "what changed" --step "how to check it" --attach demo.mp4\`. See \`cello guide\`.`
    case "AskRequired":
      return `${e.key} goes to ${e.status} only with questions for the human. Ask them instead: ` +
        `\`cello task ask ${e.key} --title "what to decide" --question "…" --option "A" --option "B"\` (or --file ask.json). See \`cello guide\`.`
    case "HumanOnly":
      return e.action === "answer an ask"
        ? `Only ${e.human} can answer the questions, on the card. Wait with \`cello wait\`, or let the hook deliver the answers.`
        : `Only ${e.human} can ${e.action}. Leave the task in In Review; ${e.human} decides on the Review page.`
    case "ProfileFieldLocked":
      return `${e.human} set ${e.field} (\`${e.value}\`), so an agent can't change it. If it's wrong, ask them on the card ` +
        `on your task: \`cello task ask <KEY-n> --title "Change ${e.field} in the testing profile?" --question "…" --option "A" --option "B"\` ` +
        "(or --file ask.json; see `cello guide`, \"Questions for the human\"), and say so in your packet."
    case "SessionNotWoken": {
      const why = NOT_WOKEN_TEXT[e.reason as NotWokenReason] ?? String(e.reason)
      return `Cello didn't wake session ${shortSession(String(e.session))}: ${why}. The card says the same.`
    }
    case "RpcClientError":
      // Connected, then cut off: the server stopped mid-command, and a write it had started still commits.
      if (["SocketCloseError", "SocketReadError", "SocketWriteError"].includes(e.reason?._tag)) {
        return `Cello on 127.0.0.1:${where.port} closed the connection before answering; it may have stopped or restarted. ` +
          "If this command changes something, the change may have gone through: check (for example with `cello task get`) " +
          "before running it again, because a rerun is a new command."
      }
      return `Cello isn't running on 127.0.0.1:${where.port}. Start it with \`cello start\`.`
    // Backups and restore, which work on the data folder itself while no server runs.
    case "RestoreBlocked":
      return `Cello is running for ${e.dataDir} (pid ${e.pid}, http://127.0.0.1:${e.port}), and restore only runs while it's stopped; ` +
        "nothing was changed. Stop it: press Ctrl-C in the terminal running `cello start`, or quit the Cello desktop app " +
        `(there's no \`cello stop\` yet). Then run \`cello restore ${e.id}\` again.`
    case "RestoreFailed": {
      const what = `The restore of ${e.id} failed while ${e.step} (${e.reason})`
      const undo = e.safetyId ? `run \`cello restore ${e.safetyId}\` (the safety backup taken just before)` : null
      if (e.unchanged) {
        return `${what}. Nothing was changed: your data is as it was${e.safetyId ? `, and safety backup ${e.safetyId} holds it too` : ""}.`
      }
      if (e.keptAt) {
        return `${what}, and moving your files back failed too. Don't start Cello yet: your data is in ${e.keptAt}/previous. ` +
          `Move everything in it back into ${e.dataDir}, replacing what's there${undo ? `, or ${undo}` : ""}.`
      }
      return `${what}, and moving files back failed too, so ${e.dataDir} may be half restored. Don't start Cello yet: ` +
        (undo ? `${undo.charAt(0).toUpperCase()}${undo.slice(1)}.` : "it held no data before the restore, so nothing was lost; run the restore again.")
    }
    case "BackupFailed":
      return `The backup failed (${e.reason}). Nothing was saved, and your data and earlier backups are untouched. ` +
        `Check that the disk has room, that every file in ${e.dataDir}/assets can be read and that ${e.dataDir}/backups can be written, ` +
        "then run `cello backup` again."
    case "ServerAlreadyRunning":
      return `Cello is running for ${e.dataDir} (pid ${e.pid}) but doesn't answer on 127.0.0.1:${where.port}. ` +
        `Run the command again with CELLO_PORT=${e.port}.`
    case "BackupNotFound":
      return `No backup ${e.id} in ${e.dir}. Run \`cello backup list\` to see them.`
    case "BackupTooNew":
      return `Backup ${e.id} was made by a newer Cello (schema level ${e.schemaLevel}; this one knows up to ${e.known}). ` +
        "Update Cello, then restore it."
    case "BackupDamaged":
      return `Backup ${e.id}'s database fails SQLite's integrity check (${e.problems}). Nothing was changed; ` +
        "pick another one from `cello backup list`."
    case "NothingToBackUp":
      return `There's no Cello database in ${e.dataDir} yet, so there's nothing to back up.`
    case "CliFailure":
      return String(e.message)
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
