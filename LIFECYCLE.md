# Lifecycle

How a Cello task goes from Todo to Done. `/cello:orchestrate` reads this file first, picks one workflow per task and follows it ([docs/claude-plugin.md](docs/claude-plugin.md)). The board's own rules (claim, stages, asking on the card, submit, done) are in [AGENTS.md](AGENTS.md) and `cello guide`. The full path with diagrams: [docs/feature-lifecycle.md](docs/feature-lifecycle.md). Change this file, that page and AGENTS.md's pointer together.

The orchestrator claims the task and runs it.

## Workflows

Each task runs one. The orchestrator picks it from "Use it when" and says which and why on the card; Lucas can change it there. When it's unclear, it asks on the card.

### feature

Use it when: anything that changes how Cello behaves or looks, or touches Lucas's data. When in doubt, this one.

1. **Plan** (stage `planning`). A `cello-planner` agent reads the task and the code and writes a step-by-step plan, test first. It never writes code.
   - Publish the plan on the task: `cello doc publish plan.md --task CEL-n --kind spec`. Its `risk: data` decides whether the data reviewer runs.
   - **Lucas approves the plan before anything is built.** Ask on the card (`cello task ask`), linking the plan page: one question "Approve the plan?" (Approve / Change it, with his notes), plus the plan's open questions. The task waits in Needs input; no builder starts until he approves.
   - Changes he asks for go back to the planner (SendMessage, same agent), then a new version of the plan and a new ask.
2. **Build** (stage `building`). A `cello-builder` agent follows the plan Lucas approved, test first, in its own worktree, and commits on its branch. It never pushes, touches main or changes the live board.
3. **Review** (stage `review`). A fresh `cello-code-reviewer` gets the diff against main, the task text and the plan, never the builder's report.
   - When the change touches Lucas's data, also run `cello-data-reviewer` on those parts. Lucas's data means migrations, backup/restore, writes outside the data folder, deleting files, or the desktop panel's security rules.
   - For UI work, the same reviewer checks every video and screenshot (its "UI work: the evidence" checklist). Give it their paths.
4. **Fix** (stage `fixing`). Findings go back to the same builder. If a blocker survives one round, or it's a design question, ask on the card.
5. **Submit, not merged yet.** Right after the review is clean: don't hold packets. The packet says what review found and fixed, which models planned, built and reviewed it, and the branch. Keep the claim and run `cello inbox --wait` in the background.
6. **Merge only after Lucas approves** (below), then `cello task done CEL-n`.
7. **No release** (below).

### small

Use it when: docs only, or a one-line fix. The `feature` workflow without its steps 1–4.

1. **Change it** (stage `building`). The orchestrator makes the change itself, still test first, on a branch in its own worktree, and commits there.
2. **Submit, not merged yet**, as in `feature` step 5.
3. **Merge only after Lucas approves** (below), then `cello task done CEL-n`.
4. **No release** (below).

## Agents

Each agent definition in `.claude/agents/` pins its model and effort. Pass the same values when starting one another way. Effort is never below medium. Why, and when to change: [docs/models.md](docs/models.md). Change the table and that page together.

| Agent | Step | Model | Effort |
| --- | --- | --- | --- |
| `cello-planner` | Plan | Opus 5.5 | high |
| `cello-builder` | Build, Fix | Sonnet 5.5 | high |
| `cello-code-reviewer` | Review | Sonnet 5.5 | medium |
| `cello-data-reviewer` | Review, when Lucas's data is touched | Sonnet 5.5 | high |
| `Explore` | Searching, any step | Haiku 5.5 | medium |
| Fable 5.2 | only when Lucas asks | | |

## Where agents work

Each builder in its own git worktree (`isolation: "worktree"`, under `.claude/worktrees/`), on its own branch. Reviewers read that branch and its worktree. Nobody builds in the main checkout, which stays on main.

## How work lands

A merge of the task's branch into main, after Lucas's "Approve and merge" (`cello context`: "Merge after approval  on"; CEL-143). **Never merge before it.** When it reaches your session (the card shows Approved · merging), or he approves in chat (pass it on first with `cello task approve CEL-n --quote "<his words>"`, after `cello task submit` if no packet is open):

- merge as `merge: <what> (CEL-n)`, which becomes the changelog line, so write it for Lucas
- then `cello task done CEL-n`. A failed merge: stage `fixing` and a comment on the card
- a Send back instead: fix, review, submit again

**The setting decides, not this file.** "Merge after I approve" is per project (`cello context` prints it). Check it at the start of a session. It's **on** for Cello: the steps above. If it ever shows **off**, merge before you submit, and Approve only moves the task to Done. Details: docs/cli.md, "Merge after I approve".

## After it lands

Run the related e2e specs on main, only those the change touches (AGENTS.md, "How to work"; [docs/testing.md](docs/testing.md)). The full Docker run only before a minor or major release, for shared-shell or config changes, or when Lucas asks. Nothing deploys: merging doesn't touch the live board.

## Releases

Releases happen only when Lucas says so ("release", "ship it"), never as a step of a task: then `bun run release` on main ([docs/releases.md](docs/releases.md)). `-- minor`/`-- major` only when he says. Never rebuild or restart the live board by hand, and never bump versions by hand.
