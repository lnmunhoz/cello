// What quitting the app does to the server it uses (CEL-81). Pure, so it's tested without Electron;
// main.ts shows the question and carries the answer out.
//
// The rule: the app never stops a server it joined (the background service, a terminal's `cello start`).
// A server it started itself is the only one quitting can stop, and only once Lucas said so: the first
// quit asks Keep Running / Stop Server / Install Background Service, and Keep or Stop is remembered.

/** A remembered answer. Install isn't remembered: once the service is installed, quitting never asks. */
export type QuitChoice = "keep" | "stop"
export type QuitAnswer = QuitChoice | "install" | "cancel"
export type QuitPlan = "leave" | "ask" | QuitChoice

/** Where the remembered answer lives, in the app's userData folder. */
export const QUIT_CHOICE_FILE = "server-on-quit.json"

export const planQuit = (facts: {
  readonly startedByUs: boolean
  /** A background service is installed for this data folder. */
  readonly service: boolean
  readonly remembered: QuitChoice | null
}): QuitPlan => {
  if (!facts.startedByUs) return "leave"
  // The service can't start while our server holds the data folder; stopping ours lets it take over.
  if (facts.service) return "stop"
  return facts.remembered ?? "ask"
}

const BUTTONS = ["Keep Running", "Stop Server", "Install Background Service", "Cancel"] as const
const ANSWERS: ReadonlyArray<QuitAnswer> = ["keep", "stop", "install", "cancel"]

/** The question, as Electron's dialog.showMessageBox takes it. */
export const QUIT_QUESTION = {
  type: "question" as const,
  message: "Keep Cello running for your agents?",
  detail:
    "This app started Cello's server. Agents in your terminals use it too: when it stops, their cello commands fail until Cello runs again.\n\n" +
    "Keep Running leaves it on after the app quits, until the Mac restarts. Install Background Service runs it from every login " +
    "(cello service install), and the app never asks again.\n\nCello remembers Keep or Stop.",
  buttons: [...BUTTONS],
  defaultId: 0,
  cancelId: BUTTONS.indexOf("Cancel"),
}

export const answerOf = (response: number): QuitAnswer => ANSWERS[response] ?? "cancel"

export const parseQuitChoice = (text: string | null): QuitChoice | null => {
  if (text === null) return null
  try {
    const choice = (JSON.parse(text) as { onQuit?: unknown }).onQuit
    return choice === "keep" || choice === "stop" ? choice : null
  } catch {
    return null
  }
}

/** The app menu's status line; null before the app has a server. */
export const serverStatusLabel = (
  facts: { readonly startedByUs: boolean; readonly service: boolean; readonly pid: number | null } | null,
): string => {
  if (!facts) return "Server: starting…"
  const who = facts.startedByUs ? "started by this app" : facts.service ? "background service" : "started outside the app"
  return `Server: ${who}${facts.pid !== null ? ` (pid ${facts.pid})` : ""}`
}
