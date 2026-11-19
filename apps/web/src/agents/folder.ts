// Where an agent on the Agents page runs (CEL-152): a subagent's own folder, which its calls report (a builder's
// worktree), else its session's, for agents seen before the server kept one and for boards on an older server.
import type { AgentSession, SessionAgent } from "@cello/contract/entities"

export const agentFolder = (row: { readonly session: AgentSession; readonly agent: SessionAgent | null }): string | null =>
  row.agent?.cwd ?? row.session.cwd
