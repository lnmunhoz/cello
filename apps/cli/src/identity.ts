// Who is calling, from the environment, as the RPC headers the server's caller middleware reads.
import { HUMAN_SESSION, IDENTITY_HEADERS } from "@cello/contract/rpcs"

/** The variables identity comes from; `whoami` prints the ones that are set. */
export const IDENTITY_VARIABLES = ["CELLO_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "CLAUDE_CODE_ENTRYPOINT"] as const

export type Env = Readonly<Record<string, string | undefined>>

/**
 * `x-cello-session` is CELLO_SESSION, else CLAUDE_CODE_SESSION_ID. The client is "Claude Code" when
 * Claude's variables are present. CELLO_SESSION=me, or no session at all, records the human.
 */
export const identityHeaders = (env: Env, cwd: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  const session = env.CELLO_SESSION || env.CLAUDE_CODE_SESSION_ID
  if (session) headers[IDENTITY_HEADERS.session] = session
  if (session && session !== HUMAN_SESSION) {
    headers[IDENTITY_HEADERS.client] = env.CLAUDE_CODE_SESSION_ID ? "Claude Code" : "Agent"
    if (env.CLAUDE_PID) headers[IDENTITY_HEADERS.pid] = env.CLAUDE_PID
    if (env.CLAUDE_CODE_ENTRYPOINT) headers[IDENTITY_HEADERS.entrypoint] = env.CLAUDE_CODE_ENTRYPOINT
  }
  headers[IDENTITY_HEADERS.cwd] = cwd
  return headers
}
