// Waking sessions (CEL-92): a task's wake from its latest wake event, and the words for it, so the
// server's snapshot, the board, the task's history and the CLI all say the same thing.
import type { NotWokenReasonSeen, TaskWake, WakeWhySeen } from "./entities.ts"
import type { CelloEvent } from "./events.ts"

/** The wake events, which `wakeOf` reads. */
export const WAKE_EVENTS = ["session.wake_scheduled", "session.not_woken", "session.run_started", "session.run_ended"] as const

/** The task a wake event is about (a run's task may be null), else null for any other event. */
export const wakeTaskOf = (e: CelloEvent): string | null => {
  switch (e.type) {
    case "session.wake_scheduled":
    case "session.not_woken":
      return e.taskId
    case "session.run_started":
    case "session.run_ended":
      return e.run.taskId
    default:
      return null
  }
}

/** Where a task's wake stands after this event, or null when it isn't a wake event about a task. */
export const wakeOf = (e: CelloEvent): TaskWake | null => {
  switch (e.type) {
    case "session.wake_scheduled":
      return { taskId: e.taskId, sessionId: e.session, state: "scheduled", why: e.why, ts: e.ts, at: e.at, reason: null, run: null }
    case "session.not_woken":
      return { taskId: e.taskId, sessionId: e.session, state: "not_woken", why: e.why, ts: e.ts, at: null, reason: e.reason, run: null }
    case "session.run_started":
    case "session.run_ended":
      if (e.run.taskId === null) return null
      return {
        taskId: e.run.taskId,
        sessionId: e.run.sessionId,
        state: e.type === "session.run_started" ? "running" : "ended",
        why: e.run.why,
        ts: e.ts,
        at: null,
        reason: null,
        run: e.run,
      }
    default:
      return null
  }
}

/** Why a session wasn't woken, in a phrase that follows "Not woken: ". */
export const NOT_WOKEN_TEXT: Record<NotWokenReasonSeen, string> = {
  listening: "its `cello inbox --wait` is running, so your comment reaches it by itself",
  process_alive: "its process is still open, so your comment reaches it with its next hook",
  recent_check_in: "it checked in less than 2 minutes ago",
  no_pid: "Cello can't tell whether its process is still open",
  disabled: "waking is off for this project",
  cap: "the limit of wakes for this task in the last hour is reached: open the chat to continue",
  bypass_mode: "it ran with bypassPermissions, which Cello never uses for a woken run",
  unknown_mode: "its permission mode isn't one its agent CLI has",
  no_conversation: "its conversation isn't on this machine",
  no_folder: "its repo folder isn't known, or isn't a folder on this machine",
  not_installed: "its agent CLI isn't installed on this machine",
  running: "Cello is already running it",
  taken: "it took your comment itself",
  cancelled: "you said don't wake it",
  other: "a reason this version of Cello doesn't know yet",
}

/** How long Cello waits after the human's last action before it wakes a session (WakeConfig, CEL-92). */
export const WAKE_BATCH_MS = 30_000

/** How far back the cap counts wakes of a task (CEL-92). */
export const WAKE_CAP_WINDOW_MS = 60 * 60_000

/** What woke it, after "Cello woke …": "(a comment)". */
export const WAKE_WHY_TEXT: Record<WakeWhySeen, string> = {
  comment: "a comment",
  answers: "answers to its questions",
  send_back: "a Send back",
  reaction: "a reaction",
  approved: "an approval to merge",
  manual: "cello sessions wake",
  other: "something this version of Cello doesn't know yet",
}

/** How a woken run ended, before "in 1 min" / "after 1 min". */
export const RUN_END_TEXT = { running: "is running", completed: "completed in", failed: "failed after", stopped: "was stopped after" } as const

/** "40 s", "1 min", "12 min", "2 h": how long a run took. */
export const runLength = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) return `${minutes} min`
  return `${Math.round(minutes / 60)} h`
}
