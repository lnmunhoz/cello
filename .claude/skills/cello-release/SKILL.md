---
name: cello-release
description: Release a new version of Cello from this repo. Previews it, asks Lucas which version, runs `bun run release` (checks, version bump, changelog, tag, build, push, GitHub release), then makes sure the live board at 127.0.0.1:4747 runs the new build, and reports. Use when Lucas asks to release, ship or cut a version of Cello, or to publish the latest updates.
---

# Release Cello

This repo has one command for a release: `bun run release`. The full reference (what it refuses, every step, the changelog rules, rolling back) is [docs/releases.md](../../../docs/releases.md). Read it if anything below surprises you. This skill is the order to run things in and what to check.

## 1. Before anything

- Work in the main checkout (`/Users/lnmunhoz/projects/cello`) on `main`, never in a worktree.
- `git status --short`: tracked files must be clean. Untracked files (like `art/motion/`) are fine; they never reach the release commit.
- Nothing merged but not yet deployed should be half-done. If a builder or merge is mid-flight, finish or park it first.
- Count what ships: `git fetch -q origin && git rev-list --count origin/main..main`. Zero means there's nothing to release; say so and stop.

## 2. Preview (changes nothing)

```bash
bun run release -- minor --dry-run   # or patch
```

Read two things in its output:
- **"a real release would refuse"** lines. If there are any, fix the cause, don't work around it. docs/releases.md lists each refusal and how to undo a half-finished earlier release.
- **The CHANGELOG.md section** it would add: one line per merged task, filed under Features, Fixes and Other changes. If a line reads badly, the merge commit's subject is what to fix next time; don't rewrite history now.

## 3. Ask Lucas the version

The version is Lucas's call. **patch** is the default for ordinary merges; **minor** and **major** only when he says so.

- He's chatting in this session (not orchestrating): ask with `AskUserQuestion`, one question with these options:
  - your recommendation first, with "(Recommended)" and why. Real new features → minor; only fixes → patch.
  - the other bump
  - "Not yet"
- Say in the question what a release does: it pushes main and the tag to GitHub, creates the GitHub release with the zips, and deploys to his board.
- In an orchestrating session, ask on a task with `cello task ask` instead. Create a "Release vX.Y.Z" task if none fits.

A release is outward-facing (GitHub). Never run it without his answer in this conversation.

## 4. Release

```bash
bun run release -- minor   # or patch / major, as he picked
```

Run it in the background (the Bash tool with `run_in_background: true`, about 5 minutes). It runs typecheck and the full unit and integration suite first, then bumps, tags, builds `cello` and Cello.app into `release/`, pushes, creates the GitHub release, and deploys.

- **A test fails before anything is written:** nothing changed. Run the failing test file alone. If it passes alone and the machine was busy, it's load: run the release again. If it fails alone, it's a real bug. Fix it as a task, then release.
- **It stops after tagging but before pushing** (a build failed): the commit and tag are local only. docs/releases.md has the `git tag -d` / `git reset --hard HEAD~1` that undo it.

## 5. Make sure the live board runs it

The deploy backs up, puts the new `cello` live, then runs `cello service restart`. **If the background service isn't installed** (`cello service status` says so), that last step fails with "cello service restart failed … the live server isn't on it yet". The release itself is fine. Restart the server yourself, by the PID that holds port 4747, never by pattern:

```bash
P=$(lsof -tiTCP:4747 -sTCP:LISTEN | head -1)
kill -TERM "$P"
# wait until $P has exited (kill -0 fails), then:
nohup /Users/lnmunhoz/.local/bin/cello start > /private/tmp/cello-start.log 2>&1 < /dev/null & disown
```

Then check:
- `cello --version` says the new version and the release commit.
- `cello context` answers (the server is up).
- `gh release view vX.Y.Z --json name,url,assets` lists the release and its zips.
- `git rev-list --count origin/main..main` is 0 (everything pushed).

## 6. Report to Lucas

Follow "Talking to Lucas" in the global instructions:
- One line: the version is out and live, and whether he needs to do anything.
- The GitHub release link.
- What shipped: the changelog's Features and Fixes, as short bullets.
- The backup the deploy took (`~/.cello/backups/<id>`), and that `cello restore <id>` with no server running undoes the deploy.
- **Test it:** reload Cello (⌘R); the sidebar footer shows the new version.

## Never

- Bump the version by hand, or edit CHANGELOG.md by hand before a release. The release refuses a version that doesn't match the latest tag.
- Push main or tags yourself outside the release (except when docs/releases.md says how to finish a half-pushed one).
- Run the desktop app or Cello.app on Lucas's Mac to "check the build". It's packaged, never opened (AGENTS.md).
- Touch `~/.cello` except through the `cello` CLI.
