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
  - His approval in chat goes to the card with `cello task approve CEL-n --quote "<his words>"` (after `cello task submit` if no packet is open), then land it; never on your own judgement.
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
  - A change you show him is a ```` ```diff ```` block of `git diff` output, headers kept (it renders as a diff view); over ~200 lines attach a `.diff` ([docs/cli.md](docs/cli.md): Showing a change).

## Lifecycle

How a task goes from Todo to Done is in [LIFECYCLE.md](LIFECYCLE.md): its workflows (`feature`: planner → Lucas approves the plan → builder in a worktree → code and data reviewers → submit → merge after his approval; `small`: docs or a one-line fix, the same without the plan, build agent and review), which agents run each step with which model, how work lands, and no release unless he asks. `/cello:orchestrate CEL-n` reads it first, picks the task's workflow and follows it ([docs/claude-plugin.md](docs/claude-plugin.md)). Full path with diagrams: [docs/feature-lifecycle.md](docs/feature-lifecycle.md). Change the flow in LIFECYCLE.md, not here.

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
bun run release              # only when Lucas says: release and deploy (minor when a feature ships, else patch); -- patch | minor | major, -- --dry-run
```

Docker runs need OrbStack. Labels, caps and output folders: [docs/testing.md](docs/testing.md).

Versions are pinned: Bun 1.4.4, Effect 4.1.4 (every `effect` and `@effect/*` package on the same version).
