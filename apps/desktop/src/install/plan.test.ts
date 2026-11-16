import { describe, expect, it } from "vitest"
import {
  checkoutRoots,
  findBuildCopies,
  INSTALLED_APP,
  LSREGISTER,
  lsregisterCommands,
  outdatedWarnings,
  parseCelloProcesses,
  parseRegisteredApps,
  parseWorktreeList,
  strayCopies,
  type DirEntry,
} from "./plan.ts"

const repo = "/Users/me/projects/cello"
const worktree = `${repo}/.claude/worktrees/agent-a1`

/** A folder tree for `readDir`: each key is a folder, each value its entries (`/` at the end marks a folder). */
const tree =
  (folders: Record<string, readonly string[]>) =>
  (dir: string): readonly DirEntry[] =>
    (folders[dir] ?? []).map((name) => ({ name: name.replace(/\/$/, ""), isDirectory: name.endsWith("/") }))

describe("parseRegisteredApps", () => {
  it("reads each bundle path from `lsregister -dump`, once, without the trailing id", () => {
    const dump = [
      "bundle id:                  Cello (0x186ec)",
      "path:                       /Applications/Cello.app (0x186ec)",
      "path:                       /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app (0x1856c)",
      "path:                       /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app (0x1856c)",
      "path:                       /Users/me/My Apps/Other Thing.app (0x12)",
      "path:                       /System/Library/Fonts/x.ttf",
      "name:                       Cello",
    ].join("\n")
    expect(parseRegisteredApps(dump)).toEqual([
      "/Applications/Cello.app",
      "/Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app",
      "/Users/me/My Apps/Other Thing.app",
    ])
  })
})

describe("parseWorktreeList", () => {
  it("reads every checkout from `git worktree list --porcelain`", () => {
    const porcelain = `worktree ${repo}\nHEAD 1f66\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD 2809\nbranch refs/heads/x\n`
    expect(parseWorktreeList(porcelain)).toEqual([repo, worktree])
  })
})

describe("checkoutRoots", () => {
  it("is the repo, its git worktrees, and every folder in .claude/worktrees (a worktree git forgot keeps its build)", () => {
    const readDir = tree({ [`${repo}/.claude/worktrees`]: ["agent-a1/", "agent-gone/", "notes.txt"] })
    expect(checkoutRoots({ mainRoot: repo, worktrees: [repo, worktree, "/elsewhere/cello-wt"], readDir })).toEqual([
      repo,
      worktree,
      "/elsewhere/cello-wt",
      `${repo}/.claude/worktrees/agent-gone`,
    ])
  })
})

describe("findBuildCopies", () => {
  it("finds Cello.app in each checkout's apps/desktop/dist* folders, without looking inside app bundles", () => {
    const readDir = tree({
      [`${repo}/apps/desktop`]: ["dist/", "dist-next/", "src/", "distance.txt"],
      [`${repo}/apps/desktop/dist`]: ["mac-arm64/", "builder-debug.yml"],
      [`${repo}/apps/desktop/dist/mac-arm64`]: ["Cello.app/"],
      [`${repo}/apps/desktop/dist/mac-arm64/Cello.app`]: ["Contents/"],
      [`${repo}/apps/desktop/dist-next`]: ["mac/"],
      [`${repo}/apps/desktop/dist-next/mac`]: ["Cello.app/", "Other.app/"],
      [`${repo}/apps/desktop/dist-next/mac/Other.app`]: ["Cello.app/"],
      [`${repo}/apps/desktop/src`]: ["Cello.app/"],
      [`${worktree}/apps/desktop`]: ["dist/"],
      [`${worktree}/apps/desktop/dist`]: ["mac-arm64/"],
      [`${worktree}/apps/desktop/dist/mac-arm64`]: ["Cello.app/"],
    })
    expect(findBuildCopies([repo, worktree], readDir)).toEqual([
      `${repo}/apps/desktop/dist/mac-arm64/Cello.app`,
      `${repo}/apps/desktop/dist-next/mac/Cello.app`,
      `${worktree}/apps/desktop/dist/mac-arm64/Cello.app`,
    ])
  })
})

describe("strayCopies", () => {
  const roots = [repo, worktree]

  it("is every build-folder copy, registered or on disk, but never the installed app", () => {
    const strays = strayCopies({
      mainRoot: repo,
      roots,
      registered: [
        INSTALLED_APP,
        `${repo}/apps/desktop/dist/mac-arm64/Cello.app`,
        // Deleted since, still registered: LaunchServices keeps it until it's unregistered.
        `${repo}/apps/desktop/dist-next/mac-arm64/Cello.app`,
        `${repo}/.claude/worktrees/agent-removed/apps/desktop/dist/mac-arm64/Cello.app`,
      ],
      onDisk: [`${worktree}/apps/desktop/dist/mac-arm64/Cello.app`, `${repo}/apps/desktop/dist/mac-arm64/Cello.app`],
      installed: INSTALLED_APP,
    })
    expect(strays).toEqual([
      `${worktree}/apps/desktop/dist/mac-arm64/Cello.app`,
      `${repo}/.claude/worktrees/agent-removed/apps/desktop/dist/mac-arm64/Cello.app`,
      `${repo}/apps/desktop/dist-next/mac-arm64/Cello.app`,
      `${repo}/apps/desktop/dist/mac-arm64/Cello.app`,
    ])
  })

  it("leaves registered copies outside the build folders alone", () => {
    const strays = strayCopies({
      mainRoot: repo,
      roots,
      registered: [
        "/Users/me/Downloads/Cello.app",
        `${repo}/apps/desktop/resources/Cello.app`,
        `${repo}/apps/desktop/dist/mac-arm64/Cello.app/Contents/Frameworks/Cello Helper.app`,
        "/Users/me/projects/cello-fork/apps/desktop/dist/mac-arm64/Cello.app",
        `${repo}/apps/desktop/dist/mac-arm64/Other.app`,
      ],
      onDisk: [],
      installed: INSTALLED_APP,
    })
    expect(strays).toEqual([])
  })
})

describe("lsregisterCommands", () => {
  it("unregisters each stray copy, then registers the installed app", () => {
    expect(lsregisterCommands(["/r/apps/desktop/dist/mac-arm64/Cello.app"], INSTALLED_APP)).toEqual([
      [LSREGISTER, "-u", "/r/apps/desktop/dist/mac-arm64/Cello.app"],
      [LSREGISTER, "-f", INSTALLED_APP],
    ])
  })

  it("still registers the installed app when there's nothing to unregister", () => {
    expect(lsregisterCommands([], INSTALLED_APP)).toEqual([[LSREGISTER, "-f", INSTALLED_APP]])
  })
})

describe("parseCelloProcesses", () => {
  it("finds Cello's main processes in `ps -axo pid=,lstart=,comm=`, not its helpers", () => {
    const ps = [
      "95951 Sun Nov 15 17:54:22 2026     /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app/Contents/MacOS/Cello",
      "96097 Sun Nov 15 17:54:24 2026     /Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app/Contents/Frameworks/Cello Helper.app/Contents/MacOS/Cello Helper",
      "  812 Mon Nov  2 09:05:01 2026     /Applications/Cello.app/Contents/MacOS/Cello",
      "  900 Mon Nov  2 09:05:01 2026     /Users/me/My Apps/Cello.app/Contents/MacOS/Cello",
      "61442 Mon Nov 16 12:40:58 2026     /Users/me/Cello.app/Contents/MacOS/Cello Launcher",
      "  1 Mon Nov 16 12:40:58 2026     /sbin/launchd",
    ].join("\n")
    expect(parseCelloProcesses(ps)).toEqual([
      { pid: 95951, app: "/Users/me/projects/cello/apps/desktop/dist/mac-arm64/Cello.app", startedAt: new Date(2026, 10, 15, 17, 54, 22) },
      { pid: 812, app: "/Applications/Cello.app", startedAt: new Date(2026, 10, 2, 9, 5, 1) },
      { pid: 900, app: "/Users/me/My Apps/Cello.app", startedAt: new Date(2026, 10, 2, 9, 5, 1) },
    ])
  })
})

describe("outdatedWarnings", () => {
  const installedAt = new Date(2026, 10, 16, 12, 0, 0)

  it("says nothing when no Cello runs, or the one running started from /Applications after the install", () => {
    expect(outdatedWarnings({ processes: [], installed: INSTALLED_APP, installedAt })).toEqual([])
    const fresh = { pid: 7, app: INSTALLED_APP, startedAt: new Date(2026, 10, 16, 12, 0, 5) }
    expect(outdatedWarnings({ processes: [fresh], installed: INSTALLED_APP, installedAt })).toEqual([])
  })

  it("tells Lucas to quit and reopen from /Applications when Cello runs from a build folder", () => {
    const stray = { pid: 95951, app: `${repo}/apps/desktop/dist/mac-arm64/Cello.app`, startedAt: new Date(2026, 10, 15, 17, 54, 22) }
    expect(outdatedWarnings({ processes: [stray], installed: INSTALLED_APP, installedAt })).toEqual([
      `Cello (pid 95951) is running from ${repo}/apps/desktop/dist/mac-arm64/Cello.app, not /Applications/Cello.app. Quit it (⌘Q) and open /Applications/Cello.app, so cello:// links reach the new build.`,
    ])
  })

  it("tells Lucas to restart a /Applications Cello that started before the install: it still runs the old build", () => {
    const old = { pid: 812, app: INSTALLED_APP, startedAt: new Date(2026, 10, 2, 9, 5, 1) }
    expect(outdatedWarnings({ processes: [old], installed: INSTALLED_APP, installedAt })).toEqual([
      "Cello (pid 812) started at 2026-11-02 09:05, before this install, so it still runs the old build. Quit it (⌘Q) and reopen /Applications/Cello.app.",
    ])
  })
})
