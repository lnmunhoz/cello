// Whether the running desktop app should offer a restart (CEL-75). Pure, so it's tested without
// Electron; main.ts reads the facts when the window takes focus and sends the notice to the board.
//
// A running app keeps the main-process code it loaded at launch: replacing its files on disk (a new
// `bun run package`, an install into /Applications) changes nothing until it restarts. The board's own
// web app reloads into a new server build by itself (CEL-37's ReloadBar); this is the same idea for the
// app around it. The build stamp (`build.json`, written by scripts/build.ts) tells builds apart.
import * as path from "node:path"
import type { DesktopAppNotice } from "../../../web/src/lib/desktop.ts"

/** The build stamp scripts/build.ts writes into dist-electron/, also copied beside app.asar. */
export const STAMP_FILE = "build.json"

const EXECUTABLE = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/

/** The `.app` bundle a packaged app's executable sits in; null for a bare Electron binary (dev, tests). */
export const bundleOf = (execPath: string): string | null => EXECUTABLE.exec(execPath)?.[1] ?? null

/**
 * Where the stamp of the build on disk is. Packaged: beside app.asar (electron-builder's extraResources),
 * because Electron keeps the archive it loaded open and would go on reading the old one. Dev:
 * dist-electron/, which `bun run build` rewrites.
 */
export const stampFile = (options: { readonly isPackaged: boolean; readonly resourcesPath: string; readonly appPath: string }): string =>
  options.isPackaged ? path.join(options.resourcesPath, STAMP_FILE) : path.join(options.appPath, "dist-electron", STAMP_FILE)

export interface UpdateFacts {
  /** The running executable (`process.execPath`). */
  readonly execPath: string
  /** The bundle it runs from (`bundleOf(execPath)`); null in dev. */
  readonly bundle: string | null
  /** The stamp read at launch; null when there was none. */
  readonly loaded: string | null
  /** The stamp on disk now; null while the bundle is missing or being replaced. */
  readonly onDisk: string | null
  /** /Applications/Cello.app */
  readonly installed: string
  readonly installedExists: boolean
}

export type AppNotice =
  /** The build on disk isn't the one this app loaded. */
  | { readonly kind: "updated"; readonly key: string; readonly restartInto: string }
  /** This app runs from another copy (a build folder) while /Applications has one. */
  | { readonly kind: "elsewhere"; readonly key: string; readonly running: string; readonly restartInto: string }

/** What the board is told (`window.celloDesktop.onAppNotice`): the notice without the executable to restart, which main keeps. */
export type BoardNotice = DesktopAppNotice

/**
 * The notice to show, or null. A copy outside /Applications restarts into /Applications' copy when there
 * is one; otherwise the app restarts itself. `key` changes when the situation does, so a notice the
 * board dismissed comes back only for a newer build.
 */
export const appNotice = (facts: UpdateFacts): AppNotice | null => {
  const installedExec = path.join(facts.installed, "Contents/MacOS/Cello")
  const elsewhere = facts.bundle !== null && facts.bundle !== facts.installed && facts.installedExists
  const restartInto = elsewhere ? installedExec : facts.execPath
  if (facts.loaded !== null && facts.onDisk !== null && facts.onDisk !== facts.loaded) {
    return { kind: "updated", key: `updated:${facts.onDisk}`, restartInto }
  }
  if (elsewhere) return { kind: "elsewhere", key: `elsewhere:${facts.bundle}`, running: facts.bundle!, restartInto }
  return null
}

/** Strips what only main needs. */
export const boardNotice = (notice: AppNotice): BoardNotice =>
  notice.kind === "updated" ? { kind: notice.kind, key: notice.key } : { kind: notice.kind, key: notice.key, running: notice.running }

/**
 * `app.relaunch`'s options: the same executable keeps its launch arguments (dev's app folder, the
 * test's switches) but not a `cello://` link it was opened with; another copy starts bare.
 */
export const relaunchOptions = (
  restartInto: string,
  running: { readonly execPath: string; readonly argv: readonly string[] },
): { execPath: string; args: string[] } =>
  restartInto === running.execPath
    ? { execPath: restartInto, args: running.argv.slice(1).filter((arg) => !arg.startsWith("cello:")) }
    : { execPath: restartInto, args: [] }
