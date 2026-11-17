---
name: cello-release
description: Release a new version of Cello from this repo (or a preview for the app's Preview channel, v0.6.0-beta.1). Previews it, asks Lucas which version, runs `bun run release` (checks, version bump, changelog, tag, push, deploy; GitHub Actions then builds the downloads and the GitHub release), then makes sure the live board at 127.0.0.1:4747 runs the new build and the Actions run published the release, and reports. Use when Lucas asks to release, ship or cut a version of Cello, or to publish the latest updates.
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

The dry run doesn't touch GitHub. When main changed the release workflow or the build scripts since the last release, test them first with a build-only run of main, which publishes nothing: `gh workflow run release.yml -f tag=v0.4.0 -f ref=main` (`tag` is the latest release tag; `ref=main` builds main's own code instead of that tag's). Wait for it with `gh run watch <id> --exit-status` in the background; release once it's green.

## 3. Ask Lucas the version

The version is Lucas's call. **patch** is the default for ordinary merges; **minor** and **major** only when he says so.

- He's chatting in this session (not orchestrating): ask with `AskUserQuestion`, one question with these options:
  - your recommendation first, with "(Recommended)" and why. Real new features → minor; only fixes → patch.
  - the other bump
  - "Not yet"
- Say in the question what a release does: it pushes main and the tag to GitHub (where GitHub Actions builds Cello.app and `cello` for Apple silicon and Intel and publishes the GitHub release), and deploys to his board.
- In an orchestrating session, ask on a task with `cello task ask` instead. Create a "Release vX.Y.Z" task if none fits.

A release is outward-facing (GitHub). Never run it without his answer in this conversation.

### Preview releases (the app's Preview channel)

A **preview** is a version like `v0.6.0-beta.1`: GitHub publishes it as a **prerelease**, and only Cello.app's **Preview** channel offers it (Settings → Updates; Stable never sees it). Offer it only when Lucas asks for a preview, beta or prerelease; never as a default.

```bash
bun run release -- preminor --preid beta   # 0.5.1 -> 0.6.0-beta.1 (prepatch: 0.5.2-beta.1, premajor: 1.0.0-beta.1)
bun run release -- prerelease              # the next preview: 0.6.0-beta.1 -> 0.6.0-beta.2
bun run release -- minor                   # from a preview, releases what it previewed: 0.6.0-beta.2 -> 0.6.0
```

Everything else is the same: the checks, the changelog section (a preview's covers what came since the last tag; the stable release after it covers everything since the last stable one), the tag, the deploy to his board, and GitHub Actions building the downloads. In step 6 check that the release says **Pre-release** on GitHub (`gh release view vX.Y.Z --json isPrerelease`). How the app picks it up: docs/releases.md, "How the app updates".

## 4. Release

```bash
bun run release -- minor   # or patch / major, as he picked
```

Run it in the background (the Bash tool with `run_in_background: true`; the tests take most of it, the rest about a minute). It runs typecheck and the full unit and integration suite first, then bumps, tags, builds this Mac's own `cello` into `release/stage`, pushes, prints the **GitHub Actions run** link, and deploys. It no longer builds Cello.app or creates the GitHub release: the pushed tag starts the Release workflow, which does both for Apple silicon and Intel in about 10 to 15 minutes.

Two apps (CEL-149): what GitHub builds is **Cello** (the download, `cello://` links, updates from GitHub); what Lucas runs from this repo is **Cello Dev** (`/Applications/Cello Dev.app`, `cello-dev://` links, a DEV badge on its icon, no update checks). The `cello` this release deploys is Cello Dev's, so its links open Cello Dev. Cello Dev's board updates with the deploy (reload it); its app shell only when Lucas runs `bun run package -- --install` in apps/desktop, which never touches `/Applications/Cello.app`.

- **A test fails before anything is written:** nothing changed. Run the failing test file alone. If it passes alone and the machine was busy, it's load: run the release again. If it fails alone, it's a real bug. Fix it as a task, then release.
- **It stops after tagging but before pushing** (a build failed): the commit and tag are local only. docs/releases.md has the `git tag -d` / `git reset --hard HEAD~1` that undo it.
- **GitHub Actions is down** (or the workflow is broken and Lucas wants the release out anyway): `bun run release -- --local-artifacts` builds the Apple silicon downloads on the Mac and creates the GitHub release from here, as releases used to.

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
- `git rev-list --count origin/main..main` is 0 (everything pushed).

## 6. Make sure GitHub Actions published the release

The deploy doesn't wait for GitHub. Once the board is fine, follow the run the release printed (or `gh run list --workflow release.yml --limit 3`). It takes about 10 to 15 minutes: wait for it with `gh run watch <id> --exit-status` in the background (Bash `run_in_background: true`), never a sleep loop. Then:

- the run is green: both build jobs (macOS arm64 and x64) and Publish
- `gh release view vX.Y.Z --json name,url,assets --jq '.name, .url, (.assets[].name)'` names `Cello vX.Y.Z` and lists **6 files**: `cello-vX.Y.Z-darwin-arm64.zip`, `cello-vX.Y.Z-darwin-x64.zip`, `Cello-vX.Y.Z-mac-arm64.dmg`, `Cello-vX.Y.Z-mac-x64.dmg`, `Cello-vX.Y.Z-mac-arm64.zip`, `Cello-vX.Y.Z-mac-x64.zip`

If a job failed, read its log (`gh run view <id> --log-failed`). The release is cut and the board runs it; only the downloads are missing. "Re-run failed jobs" (`gh run rerun <id> --failed`) when it was a flake; otherwise fix it as a task, check the fix with `gh workflow run release.yml -f tag=vX.Y.Z -f ref=main`, and docs/releases.md ("The GitHub Actions run failed") says what can still be rebuilt for that tag. Tell Lucas either way.

## 7. Report to Lucas

Follow "Talking to Lucas" in the global instructions:
- One line: the version is out and live, and whether he needs to do anything.
- The GitHub release link, and that its downloads (Apple silicon and Intel) were built by GitHub Actions; or, if the run isn't done or failed, say so and give the run's link.
- What shipped: the changelog's Features and Fixes, as short bullets.
- The backup the deploy took (`~/.cello/backups/<id>`), and that `cello restore <id>` with no server running undoes the deploy.
- **Test it:** reload Cello Dev (⌘R); the sidebar footer shows the new version. Cello.app (from a DMG) on the release's channel shows "Update available: X.Y.Z" in its footer and a toast within its next check (at launch, every 4 hours, or Settings → Updates → Check now).

## Never

- Bump the version by hand, or edit CHANGELOG.md by hand before a release. The release refuses a version that doesn't match the latest tag.
- Push main or tags yourself outside the release (except when docs/releases.md says how to finish a half-pushed one).
- Run the desktop app or Cello.app on Lucas's Mac to "check the build". It's packaged, never opened (AGENTS.md).
- Touch `~/.cello` except through the `cello` CLI.
