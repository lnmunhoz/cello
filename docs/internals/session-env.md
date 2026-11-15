# Agent session identity: what a `cello` command can see

Findings from M0 spike (a), 2026-11-14. Script: `spikes/whoami/whoami.ts` (prints agent env vars, cwd, git dirs and the process tree as JSON).

## Results by host

| Host | Session id variable | Agent pid | Notes |
| --- | --- | --- | --- |
| Claude Code in a terminal (WezTerm) | `CLAUDE_CODE_SESSION_ID` | `CLAUDE_PID`, matches the first `claude` ancestor in the process tree | `CLAUDE_CODE_ENTRYPOINT=cli`. The id survives `--resume`: a resumed conversation keeps its id. |
| Claude Code hosted by T3 Code | `CLAUDE_CODE_SESSION_ID` | `CLAUDE_PID` | `CLAUDE_CODE_ENTRYPOINT=t3-code`. No T3 thread id is exposed, so a page can't link straight to the T3 thread; the Claude session id plus `claude --resume` is what we have. |
| Nested `claude -p` started from an agent's shell | its **own** `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID` | the inner `claude` process | `CLAUDE_CODE_ENTRYPOINT=sdk-cli`. The inner agent overwrites the outer variables, so "innermost wins" happens on its own. The process tree shows both `claude` processes. |
| Claude Code subagent (Agent tool) | **the parent's** id | **the parent's** pid | Same id, same pid, same tree. Cello cannot tell a subagent from its parent. |
| Codex (`codex exec`) | not tested | not tested | The Codex account hit its usage limit (resets 2026-12-08). Rerun then. |

## What this means for the design

- **Claude Code identity works as planned.** Read `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID`; no process-tree walk is needed for Claude.
- **Liveness by pid works:** `CLAUDE_PID` is the long-lived agent process, so `kill -0 $CLAUDE_PID` tells whether the session is gone. The direct parent of `cello` is a per-command shell, as the review predicted, so it must never be used as the key.
- **Subagents share their parent's session.** Parallel subagents of one conversation count as one session for claims. Accept this for v1: a claim belongs to the conversation, and its subagents work on its behalf. Revisit if a host ever exposes a sub-agent id.
- **Store `CLAUDE_CODE_ENTRYPOINT`** on the session (`cli`, `t3-code`, `sdk-cli`), so the UI can say "Claude Code in T3 Code" and pick the right resume hint.
- **The process-tree walk is only for hosts with no session variable.** Its first known agent ancestor matched `CLAUDE_PID` in every Claude case, which validates the fallback.
- **Open:** Codex variables (after 2026-12-08). Other hosts (Cursor, Gemini CLI, OpenCode) when they're in use.

## Subagents: who is working under a session (CEL-55 spike, 2026-11-15)

Checked from inside a background subagent (Claude Code 2.1.325, launched with the Agent tool and `isolation: "worktree"`), against https://code.claude.com/docs/en/hooks and /env-vars.

**A subagent's Bash exposes no agent id or type.** Its environment carries the parent's `CLAUDE_CODE_SESSION_ID` and `CLAUDE_PID`, as before. The only differences seen were `CLAUDE_CODE_CHILD_SESSION=1` (documented: set in *every* subprocess Claude Code spawns, the main conversation's included), `AI_AGENT=claude-code_<version>_agent` (undocumented, and it says nothing about which agent) and `CLAUDE_EFFORT` (the subagent's effort level). None of them names the agent. A hook can set env vars for Bash only through `CLAUDE_ENV_FILE`, which only SessionStart, Setup, CwdChanged and FileChanged get, session-wide, so it can't give each subagent its own.

**The hooks do name it, and that is documented:**

| Where | What it carries | Guaranteed? |
| --- | --- | --- |
| PreToolUse / PostToolUse fired inside a subagent | `agent_id`, `agent_type` (common input fields) | Yes: "the input carries the `agent_id` and `agent_type` … that identify the subagent" |
| SubagentStart | `agent_id`, `agent_type`; may return `additionalContext` for the subagent | Yes; also fires when a subagent is resumed |
| SubagentStop | `agent_id`, `agent_type`, `last_assistant_message` | Yes, but it also fires for Claude Code's internal agents (prompt suggestions, `/btw`), which have no Agent tool launch |
| PostToolUse on the **Agent** tool, in the parent | `tool_input.description`, `.prompt`, `.subagent_type`; `tool_response.agentId`, `.status` (`async_launched` for background agents, returned at launch) | Yes (documented fields of the Agent tool's response) |

`agent_type` is what the parent asked for (`general-purpose`, `Explore`, a custom agent's frontmatter `name` such as `cello-builder`, or a plugin-scoped `plugin:name`), so an orchestrator that launches `general-purpose` with a builder brief shows as `general-purpose`. The id is the same one Claude Code uses for the subagent's transcript (`subagents/agent-<id>.jsonl`) and its worktree (`.claude/worktrees/agent-<id>`).

**Decision:**

- **Presence comes from the hooks** (guaranteed): every tool call a subagent makes runs the PostToolUse hook, which checks in as `agent_id` + `agent_type` under the session. SubagentStart and SubagentStop mark it started and stopped.
- **The task an agent is on comes from its launch** (guaranteed fields, a heuristic match): the parent's PostToolUse on the Agent tool reports `agentId`, `subagent_type` and the launch's description and prompt; the server links the agent to the first task key in the description, else the first in the prompt, that names a real task. A brief that names its task first (as `cello-builder` briefs do) is linked; one that names none leaves the agent under its session, with no task.
- **CLI calls are credited through `CELLO_AGENT`** (not guaranteed): since Bash can't see the id, SubagentStart hands the subagent `CELLO_AGENT=<type>/<id>` as context and asks it to put it before its `cello` commands. A call without it is credited to the session, as before. Rewriting the subagent's Bash commands from PreToolUse (`updatedInput`) would make it automatic, but it changes what permission rules and auto mode review, so it was left out.
- **Claims and inbox delivery stay on the session** (CEL-15): an agent is a sub-identity of its session, never a holder.
