# Cello

A local task board for one developer and their AI coding agents. The design is in [SPEC.md](SPEC.md); the current milestone plan is [docs/M1.md](docs/M1.md). Decisions and spike findings live in `docs/internals/`.

## Glossary

- **workspace**: a group of projects that share board columns (statuses), labels and views.
- **project**: one product, usually one repository, with its own task key (`THAI`) and backlog.
- **task**: a card. Its key is `<PROJECT>-<number>`, e.g. `THAI-12`.
- **event**: one row in `events`, written in the same transaction as the change. Every change is an event.
- **command id**: a client-made id on every write; a retry with the same id returns the stored result.
- **caller**: who is making a request (the human, or an agent session), resolved from RPC headers.
- **agent session**: one agent conversation, keyed by its host's session id (e.g. `CLAUDE_CODE_SESSION_ID`).

## Ways to hurt yourself

1. **Touching real data outside the CLI.** `~/.cello/` is Lucas's live board, served by `cello start` on port 4747. Agents read and change it **only through the `cello` CLI**. Dev servers and tests use `<worktree>/.cello/` (port 4748) or a temp folder, and never open, copy over or delete anything in `~/.cello/`.
2. **Killing by pattern.** Stop only processes you started, by the PID you captured.
3. **Logic in a handler.** RPC handlers, CLI commands and (later) MCP tools decode input, call one service method and map errors. Anything else belongs in a service, or it's missing from the other entry points.

## Tracking work in Cello

Cello's own backlog is the **CEL** project on Lucas's board (`cello start`, port 4747).

**How to use the `cello` CLI: [docs/cli.md](docs/cli.md).** It covers the concepts (statuses, claims, review packets, pages), the workflow, copy-paste examples for every command, what each error means, and a reference of every flag. Read it before your first `cello` command in a session instead of guessing. `cello guide` prints the same page in any repository.

- run `cello context` at the start of a session
- **Todo or Backlog:** Todo is ready to build. **Backlog** holds ideas and requests that still need discussing. When Lucas says "add to the backlog", create the task with `--status Backlog`. A Backlog task moves to Todo once it's agreed what to build; nobody builds from Backlog.
- `cello task claim CEL-n` before working on a task, and comment progress with `cello task comment`
- Lucas's comments and Send back notes on a task you claimed come to your session (CEL-15):
  - with the hooks installed (`cello install claude`, once per project on this machine; `--user` for every project), new ones arrive by themselves: when you stop, and after each tool call
  - without them, `cello inbox` hands them over; `cello context` lists them without taking them. Each arrives once
  - subagents share their parent's session: the hook skips them, and a subagent must not run `cello inbox`
  - act on them, then answer on the card with `cello task comment CEL-n "…"` (`--body-file -` for markdown); a sent-back task goes back to Lucas with `cello task submit`
  - `docs/cli.md`, "Comments from Lucas reach your session", has the details
- put the task key in commit messages (`feat(cli): task claim (CEL-3)`)
- hand finished work to Lucas **only with `cello task submit`**: a review packet (summary, how-to-check steps, evidence) that moves the task to **In Review**. `cello task move CEL-n "In Review"` is refused. Lucas approves it (Done) or sends it back with a note, on the Review page.
  - UI work: MP4 video(s) of the flow (the e2e videos) and screenshots, light and dark when it matters
  - how videos and screenshots are made (tools, overlay, slow motion, ffmpeg, submit): `docs/evidence-videos.md`, also in Cello's Docs tab
  - CLI or server work: a terminal recording or a test-output file, plus steps he can run
  - a report you published as a page: `--link <page url>`
  - `cello guide` has the full command
- publish reports, plans, comparisons and summaries **as pages in Cello** with `cello doc publish report.md --task CEL-n`, not as Claude artifacts. It prints the page's URL; Lucas reads it next to the task. Republishing the same file updates the page (the link stays, old versions are kept); `cello doc get <slug>` reads one back
  - pick the kind by what it's for: `--kind page` for a report on finished work (a snapshot to read now), `--kind doc` for an explanation of how something works (kept up to date when it changes), `--kind spec` for a plan before the work (linked to its tasks). When in doubt: a page is about a moment, a doc is about the system. The Docs tab's *Docs, specs and pages* doc explains it.
- to show Lucas a page, video or artifact, open it **inside Cello**: `open "cello://open?url=<url-encoded link>"` opens it in the desktop app's browser panel (claude.ai artifacts included). Use his browser only when the app isn't running.

## How a task flows: build, review, merge, submit

The session running the work (the orchestrator) claims the task, then:

1. **Build.** A `cello-builder` agent (`.claude/agents/`) works in its own git worktree, test first, and commits on its branch. It never pushes, touches main or changes the live board. The orchestrator's brief says what to build, what to read, and what other agents are changing at the same time.
2. **Review.** Before merging, a fresh `cello-code-reviewer` agent reviews the branch. It gets the diff against main and the task text, never the builder's report, so it judges the code rather than echoing the builder.
   - When the task touches Lucas's data (migrations, backups and restore, writes outside the data folder such as Claude Code settings, deleting or overwriting files, the desktop panel's security rules), use `cello-data-reviewer` instead.
   - For UI work, the code reviewer also checks the videos and screenshots, using `cello-visual-reviewer`'s checklist, so each branch gets one reviewer, not two. A separate visual reviewer only for a large visual change.
   - Reviewers run only the tests the change touches. The orchestrator runs the whole suite at merge.
3. **Fix.** Findings go back to the same builder agent, so it keeps its context. Only blockers get a re-check, by the same reviewer resumed. If one round of fixes doesn't settle a blocker, or it's a design question the task doesn't answer, ask Lucas. Comment the review's result on the card.
4. **Merge.** The orchestrator merges into main (`merge: <what> (CEL-n)`) and runs the whole suite (unit, integration, typecheck, e2e). If the server or web app changed, it rebuilds `cello` and restarts the live server, backing up first when a migration ships.
5. **Submit.** `cello task submit` with the evidence, recorded once, at the end, in review mode. The summary says what the review found and what was fixed, and which models built and reviewed it.

Small changes (docs, a one-line fix) skip steps 1–3: the orchestrator makes them directly, still test first. Later, these roles move into Cello itself (CEL-28).

**Models and effort** (decided with Lucas, Nov 15). Each agent's definition in `.claude/agents/` pins its model and effort; when starting an agent another way, pass the same values. Effort is never below medium.

| Agent | Model | Effort |
| --- | --- | --- |
| `cello-builder` (every build) | Opus 5.5 | high |
| `cello-code-reviewer` | Sonnet 5.5 | medium |
| `cello-data-reviewer` | Opus 5.5 | high |
| `cello-visual-reviewer` | Sonnet 5.5 | medium |
| Search and exploration (`Explore`) | Haiku 5.5 | medium |
| Fable 5.2 | only when Lucas asks | |

Why: Anthropic's own results put Sonnet 5.5 level with or above Opus 5.5 on terminal agentic coding (Terminal-Bench 4.0: 70.6% vs 66.4%) at half the price, while Opus leads on harder, judgment-heavy work (FrontierCode: 54.4% vs 46.2%). Haiku 5.5 is built for sub-agent lookups. When to use which, and when to move up or down: [docs/models.md](docs/models.md), also in Cello's Docs tab. Change this table and that page together.

## How to work

- **Test first.** A behavior starts as a failing test, then the code that passes it. A bug fix starts with a test that fails because of the bug.
- **Keep docs/cli.md current, in the same commit.** Any change to what agents do with Cello updates docs/cli.md in the commit that makes it. That covers a command, a flag, an output, an error message, a status or a rule (claims, reviews, Backlog). The doc should stay easy to follow for an agent seeing Cello for the first time: concepts in plain words, then the workflow, then examples.
  - **The command reference is generated.** Give every new flag and argument a description in `apps/cli/src/cli.ts`, then run `bun run docs:cli`. It rewrites the reference and `cello guide`.
  - **A test enforces it.** `apps/cli/src/reference.test.ts` fails when either has drifted from the CLI.
  - **The hand-written sections are your job,** and the code reviewer checks them.
- **Three layers, each behavior tested once at the lowest layer that can fail:**
  - unit tests next to the code (`FooService.test.ts` beside `FooService.ts`)
  - integration tests in `<package>/test/integration/`, real pieces together in one process
  - end-to-end tests in `e2e/`, the built app in a real browser, with videos
- **No sleeps, timeouts, retries or polling in tests.** Await the event, drain the worker, or advance the test clock.
- **UI is tested in Docker first, never on Lucas's screen.** `bun run test:e2e` (web) and `bun run test:docker:desktop` (the Electron app, under Xvfb) run in a throwaway Linux container, so nothing opens a window on his Mac while he works. Never run the desktop app, its e2e tests or the packaged app on the Mac: `apps/desktop/playwright.config.ts` refuses there, and `CELLO_ALLOW_LOCAL_DESKTOP=1` is only for a check that needs macOS itself (Dock, `cello://` through LaunchServices, the app menu), when he asks for one. Each run's videos, screenshots, logs and `summary.txt` land in `test-results/docker/latest/` (`web/videos`, `desktop/videos`, `desktop/screenshots`): look at them, and attach them as evidence.
- **Write it once.** Before writing a helper, look for one. Shared pure logic goes in `packages/shared` (with tests) or `packages/contract`; domain rules live in the owning service. The second copy of anything moves to a shared module and the first copy is deleted.
- **Storage failures are defects** (`Effect.orDie` at the service edge). API errors are only the tagged errors in `packages/contract/src/errors.ts`.
- **Effect style** follows T3 Code (`~/projects/t3code`): `Context.Service` classes, layers, `Effect.fn("Service.method")` for service methods. Effect's own source and tests are in `~/projects/t3code/.repos/effect` when the docs aren't enough.
- **UI primitives own their look.** `apps/web/src/components/ui` components take a `variant` or `size`; don't restyle them with `className`. No `useMemo`/`useCallback` (React Compiler). Animations only run when an event arrives; an idle board runs none.
- **Docs:** `docs/internals/` holds decisions and cross-cutting constraints only. Specs, plans and reports are published into Cello with `cello doc publish` (`--kind spec` for a spec), one page per detailed phase; the page reader follows the doc-kit look (`~/.claude/doc-kit/`).

## Commands

```bash
bun install
bun run test                 # unit + integration (Vitest)
bun run typecheck            # tsc over all packages
bun run dev                  # server on 4748 with data in ./.cello, Vite on 5199
bun run test:e2e             # web e2e (Playwright) in Docker, records videos; -- <playwright args>
bun run test:docker          # all of it in Docker: unit + integration, typecheck, web e2e, desktop e2e
bun run test:docker:e2e      # web e2e in Docker (same as test:e2e); -- e2e/board.spec.ts picks a spec
bun run test:docker:desktop  # desktop (Electron) e2e in Docker under Xvfb; -- <playwright args>
bun run test:e2e:local       # web e2e here, in headless Chromium (no window), when Docker isn't an option
bun run docs:cli             # rewrite docs/cli.md's command reference and `cello guide` from the CLI
```

- The Docker runs (`scripts/test-in-docker.ts`) need OrbStack running. They test the worktree they're run from: it's mounted read-only and copied into the container, which installs with a cached Bun store and has its own network, so the tests' default ports never meet the Mac's.
- Each run gets `test-results/docker/<time>-<label>-<pid>/`, and `test-results/docker/latest` points at the newest; two runs at once don't clash, and the last five of each mode (or `CELLO_TEST_LABEL`) are kept. `CELLO_E2E_REVIEW=1` records review videos (slow motion, each step held; see `docs/evidence-videos.md`) and is passed in, as is `CELLO_E2E_SLOWMO`; `TEST_CPUS` and `TEST_MEMORY` change the 4 CPU and 6 GB caps.
- The image (`docker/test.Dockerfile`: Playwright's image for the pinned `@playwright/test`, Bun, ffmpeg) builds on the first run and again only when the Dockerfile or those versions change.

Versions are pinned: Bun 1.4.4, Effect 4.1.4 (every `effect` and `@effect/*` package on the same version).
