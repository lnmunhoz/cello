// How an agent session is named in text, for the CLI and the web app alike ("Claude Code session 2fd0505c").

/** The first 8 characters of a host session id, enough to recognise it ("2fd0505c"). */
export const shortSession = (id: string): string => id.slice(0, 8)

/** "Claude Code session 2fd0505c": the client and the short host session id; just "Claude Code session" without an id. */
export const sessionLabel = (client: string, sessionId: string | null): string =>
  sessionId === null ? `${client} session` : `${client} session ${shortSession(sessionId)}`
