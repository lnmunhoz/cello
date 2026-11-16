// Waking sessions (CEL-92): a task's wake from its latest wake event, and the words for it, so the
// server's snapshot, the board, the task's history and the CLI all say the same thing.
import type { NotWokenReason, TaskWake, WakeWhy } from "./entities.ts"
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
export const NOT_WOKEN_TEXT: Record<NotWokenReason, string> = {
  listening: "its `cello inbox --wait` is running, so your comment reaches it by itself",
  process_alive: "its process is still open, so your comment reaches it with its next hook",
  recent_check_in: "it checked in less than 2 minutes ago",
  no_pid: "Cello can't tell whether its process is still open",
  disabled: "waking is off for this project",
  cap: "the limit of wakes for this task in the last hour is reached: open the chat to continue",
  bypass_mode: "it ran with bypassPermissions, which Cello never uses for a woken run",
  no_conversation: "its conversation isn't on this machine",
  no_folder: "Cello doesn't know its repo folder",
  not_installed: "its agent CLI isn't installed on this machine",
  running: "Cello is already running it",
  taken: "it took your comment itself",
  cancelled: "you said don't wake it",
}

/** What woke it, after "Cello woke …": "(your comment)". */
export const WAKE_WHY_TEXT: Record<WakeWhy, string> = {
  comment: "your comment",
  answers: "your answers",
  send_back: "your Send back",
  reaction: "your reaction",
  manual: "cello sessions wake",
}

/** "40 s", "1 min", "12 min", "2 h": how long a run took. */
export const runLength = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) return `${minutes} min`
  return `${Math.round(minutes / 60)} h`
}
