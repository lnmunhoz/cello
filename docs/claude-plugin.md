---
title: The Claude Code plugin, and the orchestrator thread
summary: How Cello teaches Claude Code to work with the board. `cello install claude` turns on a plugin that gives a session /cello:orchestrate (run tasks through builder and reviewer agents), /cello:work (one task in this thread), the cello skill and two generic agents. What each piece does, how it gets installed and updated, and how to change it.
---

## The short version

**`cello install claude` turns on a Claude Code plugin called `cello` in the project.** A new Claude Code session there knows how to work with the board without being told: it has two commands you type, a skill it loads by itself, and two agents the orchestrator starts.

| Piece | Who uses it | What it does |
| --- | --- | --- |
| **`/cello:orchestrate [keys, or a goal]`** | You, at the start of a thread | Makes the thread the **orchestrator**: it plans and hands the work to agents, and doesn't write the feature code itself |
| **`/cello:work <key, or what to do>`** | You | One task, done in this thread from claim to review packet |
| **The `cello` skill** | Claude, by itself, in a Cello repo | The board's rules in a few lines, and "read `cello guide`" |
| **`cello:builder`** | The orchestrator | Builds one task in its own git worktree, test first, never pushes |
| **`cello:reviewer`** | The orchestrator | Reads the diff and the task text (never the builder's report) and gives a verdict |

It's on **per project** by default, since not every project uses Cello. `cello install claude --user` turns it on everywhere.

## What an orchestrator thread does

You type `/cello:orchestrate CEL-12 CEL-14`, or a goal like `/cello:orchestrate export the board as CSV`. From then on, that thread runs the work instead of doing it.

```mermaid
flowchart TD
    A["You type /cello:orchestrate<br/>with task keys, or a goal"] --> B["① Get the tasks ready<br/>cello context · tasks from the goal · claim each"]
    B --> C["② Build<br/>stage: building<br/>one builder agent per task, each in its own worktree"]
    C --> D["③ Review<br/>stage: review<br/>a fresh reviewer: the diff and the task text, nothing else"]
    D -->|findings| E["④ Fix<br/>stage: fixing<br/>back to the same builder, so it keeps its context"]
    E --> D
    D -->|clean| F["⑤ Merge<br/>stage: merged<br/>the whole test suite, deploy if the project does"]
    F --> G(["⑥ Submit right away<br/>cello task submit: In Review"])
    D -.->|"a question only you can answer"| Q["cello task ask<br/>the card waits in Needs input"]
    Q -.-> E
```

The rules it follows for the whole run:

- **It doesn't write the feature itself.** It writes briefs, starts agents, reads their reports, merges and submits. Only tiny changes (docs, a one-line fix) it makes directly.
- **Independent tasks run at the same time; tasks that touch the same files run one after another.** Each builder's brief says what the others are changing, so they stay out of each other's files.
- **The card always says where the work is**, through `cello task stage`. Submitting clears it.
- **Your decisions are asked on the card**, never in the terminal. Your comments reach the thread by themselves through the hooks, and it answers on the card.
- **The claim belongs to the orchestrator.** Subagents run inside its session, so builders and reviewers never claim, comment, stage, submit or read the inbox.
- **It uses the project's own agents when there are any.** In this repo that's `cello-builder`, `cello-code-reviewer` and the others in `.claude/agents/`; in a repo without its own, it's `cello:builder` and `cello:reviewer`.

This is the same path as *How a feature is built, end to end*, written as instructions for the thread.

## How it gets installed

```mermaid
flowchart TD
    A["cello install claude<br/>(or cello init --hooks)"] --> B["① Check every settings file it will change<br/>bad JSON, or another marketplace called cello: refuse, write nothing"]
    B --> C["② Write the plugin's files<br/>~/.local/share/cello/claude-plugin<br/>only what changed"]
    C --> D["③ Add two entries to the settings file<br/>the folder as a marketplace · cello@cello turned on<br/>with the hooks, formatting kept, old file as .bak"]
    D --> E["④ A new Claude Code session<br/>loads the plugin from the folder, no prompt"]
```

- **The files live in a folder of Cello's own:** `$XDG_DATA_HOME/cello/claude-plugin`, by default `~/.local/share/cello/claude-plugin`. Never in the repo, never in `~/.cello`.
- **Turning it on is two entries in the settings file** the hooks already use (`.claude/settings.local.json` for this project on this machine): `extraKnownMarketplaces.cello` points at that folder, and `enabledPlugins["cello@cello"]` is `true`.
- **Cello writes those entries itself instead of running `claude plugin install`.** The `claude` command works too, but it rewrites the whole settings file every time, losing its formatting and keeping no backup. The catch: `claude plugin list` doesn't show the plugin. `claude plugin details cello@cello` does.
- **Safe to run again:** nothing changes when it's already there. A plugin you turned off (`"cello@cello": false`) stays off.
- **`--shared`** puts only the on-switch in the committed `.claude/settings.json`. The folder path stays in your git-ignored local file, since it only exists on your machine.
- **`cello uninstall claude`** removes both entries with the hooks. The folder stays, because other projects may still use it.

## Updating it

**A new `cello` carries a new plugin.** The plugin's files are built into the binary, so after rebuilding `cello`, run `cello install claude` in a project once: it rewrites the changed files in the folder, and the next session loads them. Every project that uses the folder gets the update at the same time.

Don't edit the files in that folder: the next install puts Cello's text back. For commands or skills of your own, use the project's `.claude/commands/` or `.claude/skills/`.

## Changing the plugin (for whoever works on Cello)

```mermaid
flowchart TD
    A["Edit the source<br/>apps/cli/claude-plugin/cello/…"] --> B["bun run docs:cli<br/>regenerates apps/cli/src/claudePluginFiles.ts"]
    B --> C["Tests<br/>claudePlugin.test.ts fails if the generated file<br/>and the folder differ"]
    C --> D["claude plugin validate --strict apps/cli/claude-plugin"]
    D --> E["Rebuild cello, then cello install claude<br/>in a project to try it"]
```

- **Source:** `apps/cli/claude-plugin/` is a local marketplace with one plugin, `cello/`:
  - `commands/orchestrate.md` and `commands/work.md`
  - `skills/cello/SKILL.md`
  - `agents/builder.md` and `agents/reviewer.md`
  - `.claude-plugin/plugin.json`, whose version must match Cello's (a test checks it)
- **Embedding:** `bun run docs:cli` turns the folder into `apps/cli/src/claudePluginFiles.ts`, the same way it generates `cello guide`. `bun apps/cli/scripts/docs.ts --check` and a unit test both fail when they drift.
- **Install code:** `apps/cli/src/claudePlugin.ts` writes the folder; `apps/cli/src/claudeSettings.ts` adds and removes the settings entries; `installHooks` in `apps/cli/src/cli.ts` runs both.
- **Keep it project-neutral.** The plugin runs in every repo tracked in Cello, so it names commands, not this repo's agents or paths. Point to `cello guide` instead of copying flags, so it can't drift from the CLI.
- **Keep the skill short.** It's loaded into every session in the project (about 260 tokens for the whole plugin).

The agent-facing details (every edge case of install and uninstall) are in *The cello CLI, for agents*, section "The Claude Code plugin".
