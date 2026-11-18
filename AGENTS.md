# Cello

A local task board for one developer and their AI coding agents. The design is in [SPEC.md](SPEC.md). Decisions and spike findings live in `docs/internals/`.

## Glossary

- **workspace**: a group of projects that share board columns (statuses) and views. Labels are per project.
- **project**: one product, usually one repository, with its own task key (`THAI`) and backlog.
- **task**: a card. Its key is `<PROJECT>-<number>`, e.g. `THAI-12`.
- **event**: one row in `events`, written in the same transaction as the change. Every change is an event.
- **command id**: a client-made id on every write; a retry with the same id returns the stored result.
- **caller**: who is making a request (the human, or an agent session), resolved from RPC headers.
- **agent session**: one agent conversation, keyed by its host's session id (e.g. `CLAUDE_CODE_SESSION_ID`).

## Ways to hurt yourself

1. **Touching real data outside the CLI.** `~/.cello/` is Lucas's live board, served by `cello start` on port 4747. Agents read and change it **only through the `cello` CLI**. Dev servers and tests use `<worktree>/.cello/` (port 4748) or a temp folder. They never open, copy over or delete anything in `~/.cello/`.
2. **Killing by pattern.** Stop only processes you started, by the PID you captured.
3. **Logic in a handler.** RPC handlers, CLI commands and (later) MCP tools decode input, call one service method and map errors. Anything else belongs in a service, or it's missing from the other entry points.

## Tracking work in Cello

Cello's own backlog is the **CEL** project on Lucas's board. Run `cello context` at the start of a session. Before your first other `cello` command, read [docs/cli.md](docs/cli.md) (`cello guide` prints the same). It has the concepts, every command, the errors and the flags. Don't guess.

- **Is Lucas asking for work, or just talking?** Questions and brainstorming need no task. Work (build, fix, change, write) starts as a task before you read code or plan: find it, or `cello task create` it with his words, then claim it. Small requests, follow-ups and mid-task requests count too.
- **Todo is ready to build. Backlog is ideas still being discussed.** "Add to the backlog" means `--status Backlog`. Nobody builds from Backlog.
- **Claim before working** (`cello task claim CEL-n`). Comment progress with `cello task comment`. Put the key in commit messages: `feat(cli): task claim (CEL-3)`.
- **In Progress means someone is on it right now.** Mark the step with `cello task stage CEL-n building|review|fixing|merged`.
  - Waiting on Lucas: ask on the card with `cello task ask`.
  - Pausing: put the state on the card, move it back to Todo and release it.
- **Lucas's comments reach your session** through the hooks, or `cello inbox`.
  - When you end a turn while holding a claimed task, start `cello inbox --wait` in the background.
  - Subagents never run `cello inbox`.
  - Answer on the card.
- **Feedback Lucas gives in chat is a review too.**
  - Put it on the task in his words: `**Lucas, in chat (review):** "…"`.
  - If the task is In Review or Done, move it back to In Progress before fixing, then submit a new packet.
- **Lucas's decisions are asked on the card, never in the terminal** (design options, stages, wording):
  - use `cello task ask CEL-n --file ask.yaml --wait` in the background, with a recommended option and its `because`, plus the evidence
  - scopes attach their screenshots and link the scope page
  - never use Claude's `AskUserQuestion` when nobody watches the window: orchestrating, in a subagent, or in a run Cello woke (the hook denies it)
  - a session chatting with Lucas may use the dialog
- **Hand work in only with `cello task submit`:** a summary, how-to-check steps and evidence.
  - UI work: MP4 videos of the flow and screenshots, light and dark when it matters ([docs/evidence-videos.md](docs/evidence-videos.md)).
  - CLI or server work: a terminal recording or test output, plus steps he can run.
  - Work that validates a flow: add a ```mermaid flowchart TD to the summary. Lucas understands visuals first.
- **Show Lucas things as Cello pages, never Claude artifacts:** this repo's rule beats your global instructions. That covers reports, plans, comparisons, and videos or screenshots before a packet.
  - Publish with `cello doc publish page.md --task CEL-n` (`--asset` for videos; `--kind page|doc|spec`), and open with `cello open <slug | url | KEY-n>`.
  - In replies, link the `cello://` link those commands print, never the http one.

## How a task flows

The orchestrator claims the task and runs it. Full path with diagrams: [docs/feature-lifecycle.md](docs/feature-lifecycle.md). `/cello:orchestrate CEL-n` takes this role ([docs/claude-plugin.md](docs/claude-plugin.md)).

1. **Plan.** A `cello-planner` agent (stage `planning`) reads the task and the code and writes a step-by-step plan, test first. It never writes code.
   - Publish the plan on the task: `cello doc publish plan.md --task CEL-n --kind spec`.
   - Its open questions go on the card (`cello task ask`) before building starts. Its `risk: data` decides whether the data reviewer runs.
2. **Build.** A `cello-builder` agent follows the plan, test first, in its own worktree, and commits on its branch. It never pushes, touches main or changes the live board.
3. **Review.** A fresh `cello-code-reviewer` gets the diff against main, the task text and the plan, never the builder's report.
   - When the change touches Lucas's data, also run `cello-data-reviewer` on those parts. Lucas's data means migrations, backup/restore, writes outside the data folder, deleting files, or the desktop panel's security rules.
   - For UI work, the same reviewer checks every video and screenshot (its "UI work: the evidence" checklist). Give it their paths.
4. **Fix.** Findings go back to the same builder. If a blocker survives one round, or it's a design question, ask on the card.
5. **Merge and release.** Merge as `merge: <what> (CEL-n)`, which becomes the changelog line, so write it for Lucas. Run the related e2e specs. Then run `bun run release` on main.
   - Every deploy is a release. Never rebuild or restart by hand.
   - Use `-- minor`/`-- major` only when Lucas says. `-- --dry-run` previews.
   - Never bump versions by hand. Details: [docs/releases.md](docs/releases.md).
6. **Submit right after the release.** Don't batch merges or hold packets. The packet says what review found and fixed, which models built and reviewed it, and the release (`v0.3.1`).

Small changes (docs, a one-line fix) skip steps 1–4, still test first.

**When the merge happens is a per-project setting, "Merge after I approve"** (`cello context` prints it; CEL-143):

- **off** (Cello's own project): the steps above. Lucas reviews what's already released, and Approve moves the task to Done.
- **on** (new projects with a repository): build → review → submit (with the PR link when the project uses PRs) → wait for Lucas's "Approve and merge" (`cello inbox --wait`) → merge and release → `cello task done CEL-n`. A failed merge: stage `fixing` and a comment. Details: docs/cli.md, "Merge after I approve".

**Models and effort.** Each agent definition in `.claude/agents/` pins its model and effort. Pass the same values when starting one another way. Effort is never below medium. Why, and when to change: [docs/models.md](docs/models.md). Change the table and that page together.

| Agent | Model | Effort |
| --- | --- | --- |
| `cello-planner` | Opus 5.5 | high |
| `cello-builder` | Sonnet 5.5 | high |
| `cello-code-reviewer` | Sonnet 5.5 | medium |
| `cello-data-reviewer` | Sonnet 5.5 | high |
| `Explore` | Haiku 5.5 | medium |
| Fable 5.2 | only when Lucas asks | |

## How to work

- **Test first.** A behavior starts as a failing test, and a bug fix as a test that fails because of the bug.
- **One layer per behavior:** unit next to the code, integration in `<package>/test/integration/`, e2e in `e2e/`. Test each behavior at the lowest layer that can fail.
- **No sleeps, timeouts, retries or polling in tests.** The one exception, `UNDER_LOAD`, is for tests that launch a real OS process: [docs/testing.md](docs/testing.md).
- **Run only the e2e specs a change touches.** Name them in the report. The full suite runs only for shared-shell or config changes, before a minor or major release, or when Lucas asks: [docs/testing.md](docs/testing.md).
- **UI is tested in Docker, never on Lucas's screen.** Never run the desktop app or its e2e on the Mac. Results land in `test-results/docker/latest/`; look at them and attach them.
- **Keep docs/cli.md current, in the same commit,** for any change to what agents do with Cello.
  - The command reference is generated: describe each flag in `apps/cli/src/cli.ts`, then run `bun run docs:cli`. `apps/cli/src/reference.test.ts` enforces it.
  - The hand-written sections are your job.
- **Write it once.** Look for a helper before writing one. Shared pure logic goes in `packages/shared` or `packages/contract`; domain rules live in the owning service. When a second copy appears, move it to a shared module and delete the first.
- **Errors:** storage failures are defects (`Effect.orDie` at the service edge). API errors are only the tagged errors in `packages/contract/src/errors.ts`.
- **Effect style** follows T3 Code (`~/projects/t3code`): `Context.Service` classes, layers, and `Effect.fn("Service.method")`. Effect's source is in `~/projects/t3code/.repos/effect`.
- **UI:**
  - `apps/web/src/components/ui` primitives take a `variant` or `size`; never restyle them with `className`.
  - No `useMemo`/`useCallback` (React Compiler).
  - Animations run only when an event arrives or an agent is working on a card.
- **Docs:** `docs/internals/` holds decisions only. Specs, plans and reports are published into Cello with `cello doc publish`.
- **Backups:** agents run `cello restore` only when Lucas asks. How backups work: `apps/server/src/backup/README.md`.

## Commands

```bash
bun install
bun run test                 # unit + integration (Vitest)
bun run typecheck            # tsc over all packages
bun run dev                  # server on 4748 with data in ./.cello, Vite on 5199
bun run test:e2e             # web e2e (Playwright) in Docker; -- e2e/board.spec.ts picks a spec
bun run test:docker          # everything in Docker: unit + integration, typecheck, web and desktop e2e
bun run test:docker:desktop  # desktop (Electron) e2e in Docker under Xvfb; -- <spec>
bun run test:e2e:local       # web e2e here in headless Chromium, when Docker isn't an option
bun run docs:cli             # regenerate docs/cli.md's reference and `cello guide`
bun run release              # the merge step: release (patch) and deploy; -- minor | major, -- --dry-run
```

Docker runs need OrbStack. Labels, caps and output folders: [docs/testing.md](docs/testing.md).

Versions are pinned: Bun 1.4.4, Effect 4.1.4 (every `effect` and `@effect/*` package on the same version).
