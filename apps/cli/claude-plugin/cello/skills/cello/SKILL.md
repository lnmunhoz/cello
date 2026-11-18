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
- **Mark your step** with `cello task stage <KEY>`, whoever you are: on your own, `building` while you write code and `merged` once it's merged; an orchestrator, `building`, `review`, `fixing`, `merged`. Pick by the task: `planning` only when it needs a decision before code (a spec, a scope with options, a question to the person), and it stays there until that's settled; a clear task goes straight to `building`; a design question while building sends it back to `planning`. A task with no stage shows only as Working while you're active, which can't say which step.
- Test first. Comment progress and decisions with `cello task comment`.
- **Decisions that are the person's** (a design option, a scope, wording) are asked on the card with `cello task ask`, never in the terminal. Orchestrating (`/cello:orchestrate`), in a subagent or in a run Cello woke, never with Claude's `AskUserQuestion`: nobody watches that window, and the hook denies it. If no open task of yours fits (yours was approved, or it's a new decision), create one, claim it and ask there. A session chatting with the person may use the dialog.
- Their comments reach your session by themselves with the hooks (else `cello inbox`). Answer on the card.
- When you end a turn while holding a claimed task, start `cello inbox --wait` in the background, so their comments wake you while you're idle.
- In Progress means someone is on it now. Pausing: put the state on the card, move it back to Todo, `cello task release`.
- **How to test and collect evidence here** is the project's testing profile, shown by `cello context` (`cello profile` for all of it): use its commands for tests, the app and e2e videos. It's current best knowledge: when a command in it fails or the repo changes, fix it with `cello profile set` and say so in your packet. Fields the person set are theirs: ask on the card with `cello task ask`.
- Hand finished work in only with `cello task submit`: a summary, how to check it, and evidence.
- **Show a change as a diff.** When the person asks what you changed, or a comment, summary or page needs the code, paste `git diff` output in a ```diff block, headers kept: Cello draws it as a diff view (files, counts, colours, line numbers). Over about 200 lines, attach a `.diff` file instead (`cello guide`: Showing a change).
- **When to merge** is the project's setting, on the Merge after approval line of `cello context`. **Off:** merge (and deploy) first, then submit; Approve moves the task to Done. **On:** submit before you merge (attach the PR with `--link` when the project uses PRs), keep the claim, and wait (`cello inbox --wait`): the person's Approve tells you to merge it now. When they approve in your chat instead ("Approved, commit"), pass it on with `cello task approve <KEY> --quote "<their words>"` (submit first if no packet is open; only their own words, never your judgement). Merge and deploy the way the project says, then `cello task done <KEY>` moves it to Done. A failed merge: `cello task stage <KEY> fixing` and a comment on the card.
- Show reports, plans and evidence as Cello pages (`cello doc publish page.md --task <KEY>`), opened with `cello open <slug>`. In replies, link a page with the `cello://` link those commands print, never its http address: an http link opens your host's browser, not Cello.

How a task goes from Todo to Done here (its steps, agents, where they work, how work lands) is the project's own, in `LIFECYCLE.md` at the repo root: follow it. To run tasks through agents, `/cello:orchestrate`.
