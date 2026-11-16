// Who is calling, from the environment, as the RPC headers the server's caller middleware reads.
import { HUMAN_SESSION, IDENTITY_HEADERS } from "@cello/contract/rpcs"

/** The variables identity comes from; `whoami` prints the ones that are set. */
export const IDENTITY_VARIABLES = ["CELLO_SESSION", "CELLO_AGENT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_PID", "CLAUDE_CODE_ENTRYPOINT"] as const

export type Env = Readonly<Record<string, string | undefined>>

/**
 * CELLO_AGENT (CEL-55): the session's subagent making the call, as `<type>/<id>` ("cello-builder/a13bfb89")
 * or just `<id>`. A type may hold a colon (a plugin's `plugin:reviewer`), never a slash.
 */
export const parseAgent = (value: string | undefined): { readonly id: string; readonly type: string | null } | null => {
  const text = value?.trim()
  if (!text) return null
  const slash = text.lastIndexOf("/")
  const id = text.slice(slash + 1).trim()
  const type = slash > 0 ? text.slice(0, slash).trim() : ""
  return id ? { id, type: type || null } : null
}

/** The CELLO_AGENT value for an agent: `<type>/<id>`, or the id alone when the type isn't known. */
export const agentVariable = (agent: { readonly id: string; readonly type: string | null }): string =>
  agent.type ? `${agent.type}/${agent.id}` : agent.id

/**
 * `x-cello-session` is CELLO_SESSION, else CLAUDE_CODE_SESSION_ID. The client is "Claude Code" when
 * Claude's variables are present. CELLO_SESSION=me, or no session at all, records the human. CELLO_AGENT
 * adds the session's subagent (`x-cello-agent`, `x-cello-agent-type`).
 */
export const identityHeaders = (env: Env, cwd: string): Record<string, string> => {
  const headers: Record<string, string> = {}
  const session = env.CELLO_SESSION || env.CLAUDE_CODE_SESSION_ID
  if (session) headers[IDENTITY_HEADERS.session] = session
  if (session && session !== HUMAN_SESSION) {
    headers[IDENTITY_HEADERS.client] = env.CLAUDE_CODE_SESSION_ID ? "Claude Code" : "Agent"
    if (env.CLAUDE_PID) headers[IDENTITY_HEADERS.pid] = env.CLAUDE_PID
    if (env.CLAUDE_CODE_ENTRYPOINT) headers[IDENTITY_HEADERS.entrypoint] = env.CLAUDE_CODE_ENTRYPOINT
    const agent = parseAgent(env.CELLO_AGENT)
    if (agent) headers[IDENTITY_HEADERS.agent] = agent.id
    if (agent?.type) headers[IDENTITY_HEADERS.agentType] = agent.type
    // Set by the hooks only (claudeHook.ts hookIdentity): the session's permission mode (CEL-92).
    if (env.CELLO_PERMISSION_MODE) headers[IDENTITY_HEADERS.permissionMode] = env.CELLO_PERMISSION_MODE
    // Set by the hooks only (hookIdentity): the caller's transcript and current step (CEL-106).
    if (env.CELLO_TRANSCRIPT) headers[IDENTITY_HEADERS.transcript] = env.CELLO_TRANSCRIPT
    if (env.CELLO_STEP) headers[IDENTITY_HEADERS.step] = env.CELLO_STEP
  }
  headers[IDENTITY_HEADERS.cwd] = cwd
  return headers
}
