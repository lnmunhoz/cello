---
name: cello
description: How to track work on a Cello board with the cello CLI. Use in a repository tracked in Cello (its AGENTS.md or CLAUDE.md has a "Tracking work in Cello" section, or `cello context` shows a project) before starting work someone asked for, and whenever you create, claim, comment on, ask about or submit a task, or publish a page for the person who owns the board.
---

# Working with Cello

Cello is a task board shared by a person and their coding agents. Agents use it only through the `cello` CLI.

- Run `cello context` at the start of a session. Read `cello guide` once before your first other `cello` command: it's the full reference. Don't guess flags.
- **Work starts as a task.** Questions and brainstorming need none. A request to build, fix, change or write does: check the board (`cello task list`), else `cello task create` with the person's words, before you read code or plan.
- Todo is ready to build; Backlog is ideas still being discussed. Nobody builds from Backlog.
- `cello task claim <KEY>` before you work on it. Put the key in every commit message.
- Test first. Comment progress and decisions with `cello task comment`.
- **Decisions that are the person's** (a design option, a scope, wording) are asked on the card with `cello task ask`, never in the terminal.
- Their comments reach your session by themselves with the hooks (else `cello inbox`). Answer on the card.
- In Progress means someone is on it now. Pausing: put the state on the card, move it back to Todo, `cello task release`.
- Hand finished work in only with `cello task submit`: a summary, how to check it, and evidence.
- Show reports, plans and evidence as Cello pages (`cello doc publish page.md --task <KEY>`).

For several tasks, or work big enough for builder and reviewer agents, run `/cello:orchestrate`. For one task in this thread, `/cello:work`.
