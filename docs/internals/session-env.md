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
