---
title: Testing Cello
summary: How Cello is tested. The three test layers, the no-sleeps rule and its one exception, which e2e specs to run for a change, and how the Docker runs work (where videos land, labels, CPU and memory caps).
---

# Testing Cello

AGENTS.md has the short version. This page holds the detail.

## Three layers

Each behavior is tested once, at the lowest layer that can fail:

- **Unit tests** sit next to the code (`FooService.test.ts` beside `FooService.ts`).
- **Integration tests** live in `<package>/test/integration/`: real pieces working together in one process.
- **End-to-end tests** live in `e2e/`: the built app in a real browser, recorded on video.

## No sleeps, timeouts, retries or polling

Await the event, drain the worker, or advance the test clock.

**One exception (the human, Nov 17, CEL-121):** a test whose point is launching a real OS process may take `UNDER_LOAD`, a 30 s limit defined in `apps/cli/test/integration/cli.ts`. Examples: the CLI as Claude Code runs it, or a real `cello start`. Add a comment giving the test's measured time idle and under load. Anything else that's slow under load gets less work instead: a shared server or repo per file, smaller tests, calls in process.

## Pick the e2e specs

Don't run the full e2e suite every time (the human, Nov 16: the full run adds up as the project grows). Unit, integration and typecheck are fast and always run in full. For e2e, builders, reviewers and the orchestrator at merge run only the specs that cover what changed:

- **Name them:** `bun run test:e2e -- e2e/taskpanel.spec.ts e2e/pagepanel.spec.ts` for web, `bun run test:docker:desktop -- <spec>` for desktop (only when the desktop app changed).
- **Pick them by what the change touches:** the spec for the screen or flow you changed, plus specs for screens that share the component (`grep -l` the component, route or test id in `e2e/`).
- **No UI effect, no e2e:** a server-only, CLI-only or docs change runs none, unless an e2e spec exercises that path.
- **Report them:** name the specs you ran, and why those, in the build report and the review packet.

The **full e2e suite** (`bun run test:docker`, or `bun run test:e2e` with no spec) runs only in these cases:

- the change touches what every screen shares: the app shell, routing, `e2e/fixtures.ts` or other e2e helpers, the Docker test setup, the Playwright or Vite config, or a dependency
- before a minor or major release, or a packaged build (releases happen only when the human says; not before each merge)
- when the human asks

## UI runs in Docker, never on the human's screen

`bun run test:e2e` (web) and `bun run test:docker:desktop` (the Electron app, under Xvfb) run in a throwaway Linux container, so nothing opens a window on their Mac while they work.

- **Never run the desktop app, its e2e tests or the packaged app on the Mac.** `apps/desktop/playwright.config.ts` refuses to run there.
- `CELLO_ALLOW_LOCAL_DESKTOP=1` is only for a check that needs macOS itself (the Dock, `cello://` through LaunchServices, the app menu), and only when they ask for one.

## How the Docker runs work

- **What they need:** the runs (`scripts/test-in-docker.ts`) need OrbStack running.
- **What they test:** the worktree they're run from. It's mounted read-only and copied into the container, which installs with a cached Bun store. The container has its own network, so the tests' default ports never meet the Mac's.
- **Where results land:** each run gets `test-results/docker/<time>-<label>-<pid>/`, and `test-results/docker/latest` points at the newest. Videos, screenshots, logs and `summary.txt` are there (`web/videos`, `desktop/videos`, `desktop/screenshots`). Look at them, and attach them as evidence.
- **Runs at once and cleanup:** two runs at once don't clash. The last five of each mode (or of each `CELLO_TEST_LABEL`) are kept.
- **Environment passed in:** `CELLO_E2E_REVIEW=1` records review videos (slow motion, each step held; see [evidence-videos.md](evidence-videos.md)). `CELLO_E2E_SLOWMO` is passed in too.
- **Caps:** 4 CPUs and 6 GB by default. `TEST_CPUS` and `TEST_MEMORY` change them.
- **The image** (`docker/test.Dockerfile`: Playwright's image for the pinned `@playwright/test`, plus Bun and ffmpeg) builds on the first run. It rebuilds only when the Dockerfile or those versions change.
