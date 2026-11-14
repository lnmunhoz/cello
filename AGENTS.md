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

Cello's own backlog is the **CEL** project on Lucas's board (`cello start`, port 4747). Once the `cello` CLI exists (M2 step B2):

- run `cello context` at the start of a session
- `cello task claim CEL-n` before working on a task, and comment progress with `cello task comment`
- put the task key in commit messages (`feat(cli): task claim (CEL-3)`)
- move finished work to **In Review**; Lucas moves it to Done

## How to work

- **Test first.** A behavior starts as a failing test, then the code that passes it. A bug fix starts with a test that fails because of the bug.
- **Three layers, each behavior tested once at the lowest layer that can fail:**
  - unit tests next to the code (`FooService.test.ts` beside `FooService.ts`)
  - integration tests in `<package>/test/integration/`, real pieces together in one process
  - end-to-end tests in `e2e/`, the built app in a real browser, with videos
- **No sleeps, timeouts, retries or polling in tests.** Await the event, drain the worker, or advance the test clock.
- **Write it once.** Before writing a helper, look for one. Shared pure logic goes in `packages/shared` (with tests) or `packages/contract`; domain rules live in the owning service. The second copy of anything moves to a shared module and the first copy is deleted.
- **Storage failures are defects** (`Effect.orDie` at the service edge). API errors are only the tagged errors in `packages/contract/src/errors.ts`.
- **Effect style** follows T3 Code (`~/projects/t3code`): `Context.Service` classes, layers, `Effect.fn("Service.method")` for service methods. Effect's own source and tests are in `~/projects/t3code/.repos/effect` when the docs aren't enough.
- **UI primitives own their look.** `apps/web/src/components/ui` components take a `variant` or `size`; don't restyle them with `className`. No `useMemo`/`useCallback` (React Compiler). Animations only run when an event arrives; an idle board runs none.
- **Docs:** `docs/internals/` holds decisions and cross-cutting constraints only. Specs and plans with phases are published as artifact pages with a **Phases** list at the top of the sidebar (one page per detailed phase); the kit is `~/.claude/doc-kit/`.

## Commands

```bash
bun install
bun run test         # unit + integration (Vitest)
bun run typecheck    # tsc over all packages
bun run dev          # server on 4748 with data in ./.cello, Vite on 5199
bun run test:e2e     # Playwright, records videos
```

Versions are pinned: Bun 1.4.4, Effect 4.1.4 (every `effect` and `@effect/*` package on the same version).
