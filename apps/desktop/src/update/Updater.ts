// Cello.app's update check (CEL-140), in the main process: asks the release feed at launch, every 4 hours
// and on Check now; keeps an `UpdateState` (packages/shared/src/updates.ts) and tells the board each
// change (main.ts sends it through the preload bridge); downloads the new release's DMG into Downloads,
// in the background when "Download updates automatically" is on; and on Download hands the DMG to the
// installer.
//
// The installer is the seam where the one-click update goes later. Today it opens the DMG in Finder and
// the user drags Cello over the old copy (it works unsigned). Two ways to replace it, Lucas's pick:
// - electron-updater's `quitAndInstall`, once Cello.app is signed with a Developer ID (Squirrel.Mac only
//   installs an update signed by the same developer); the feed then also needs the app zip and
//   latest-mac.yml the release workflow would publish
// - Cello's own swap: unpack the app zip next to /Applications/Cello.app, quit, move it over, relaunch
// Either is an `Installer` whose `install` takes the downloaded file; nothing else here changes.
import * as fs from "node:fs"
import * as path from "node:path"
import {
  dmgName,
  initialUpdateState,
  parseReleases,
  RELEASE_URL_PREFIX,
  parseUpdateSettings,
  settingsOf,
  type UpdateCommand,
  type UpdateEvent,
  type UpdateState,
  updateReducer,
} from "@cello/shared/updates"
import type { ReleaseFeed } from "./feed.ts"

/** How often the app asks for releases, besides at launch and on Check now. */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

/**
 * Downloads `url` into `file`, complete or not at all: a failure leaves `file` as it was. `size` is what
 * GitHub says the file has (0 when it didn't say), checked before `file` is written. Progress is 0 to 1.
 */
export type FetchFile = (url: string, file: string, size: number, onProgress: (fraction: number) => void) => Promise<void>

/** What Download does with the downloaded release: open the DMG today; install it in one click later. */
export interface Installer {
  /** The button's word: "Download" while it opens the DMG, "Restart to update" for a one-click installer. */
  readonly action: string
  install(file: string): Promise<void>
}

/**
 * Today's installer: opens the DMG (Finder mounts it and shows Cello beside Applications) with `open`,
 * Electron's `shell.openPath`, which answers "" or why it couldn't.
 */
export const openDmg = (open: (file: string) => Promise<string>): Installer => ({
  action: "Download",
  install: async (file) => {
    const problem = await open(file)
    if (problem) throw new Error(problem)
  },
})

export interface UpdaterOptions {
  /** The running version. */
  readonly current: string
  /** `process.arch`: picks the DMG (arm64 or x64). */
  readonly arch: string
  readonly feed: ReleaseFeed
  /**
   * Where a release's page and DMGs may be (`feedFor`): the repository on GitHub by default; the e2e
   * tests' feed adds its own origin. Anything else in the feed's answer is dropped.
   */
  readonly trusted?: ReadonlyArray<string>
  /** userData/updates.json: the channel, automatic downloads, and what was already shown. */
  readonly settings: { read(): string | null; write(text: string): void }
  /** Where DMGs are saved: ~/Downloads. */
  readonly downloadsDir: string
  readonly fetchFile: FetchFile
  readonly installer: Installer
  /** A release with no DMG for this Mac: its page on GitHub, in the browser. */
  readonly openExternal: (url: string) => void
  readonly now: () => number
}

export class Updater {
  #state: UpdateState
  readonly #options: UpdaterOptions
  readonly #listeners = new Set<(state: UpdateState) => void>()
  #checking: Promise<void> | null = null
  /** The download running, by version. */
  readonly #downloads = new Map<string, Promise<boolean>>()

  /** The settings as last read or written. */
  #saved: string | null

  constructor(options: UpdaterOptions) {
    this.#options = options
    this.#saved = options.settings.read()
    this.#state = initialUpdateState({ current: options.current, arch: options.arch, settings: parseUpdateSettings(this.#saved) })
    this.#save()
  }

  get state(): UpdateState {
    return this.#state
  }

  /** Calls `listener` on each change, until the returned function is called. */
  onChange(listener: (state: UpdateState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Asks the feed for releases; a check already running is joined, not repeated. Never throws. */
  check(): Promise<void> {
    this.#checking ??= this.#check().finally(() => (this.#checking = null))
    return this.#checking
  }

  async #check(): Promise<void> {
    this.#dispatch({ type: "check-started" })
    try {
      const releases = parseReleases(await this.#options.feed.read(), this.#options.trusted ?? [RELEASE_URL_PREFIX])
      this.#dispatch({ type: "checked", releases, at: this.#options.now() })
    } catch (error) {
      this.#dispatch({ type: "check-failed", message: error instanceof Error ? error.message : String(error), at: this.#options.now() })
    }
    this.#prepare()
  }

  /** A command from the board (already checked by `parseUpdateCommand`). */
  async command(command: UpdateCommand): Promise<void> {
    switch (command.kind) {
      case "check":
        return this.check()
      case "download":
        return this.#download()
      case "channel":
        this.#dispatch({ type: "channel", channel: command.channel })
        return this.#prepare()
      case "auto-download":
        this.#dispatch({ type: "auto-download", on: command.on })
        return this.#prepare()
      case "acknowledge":
        return this.#dispatch({ type: "acknowledged", what: command.what, version: command.version })
    }
  }

  /** Download: the DMG opens (downloaded first when it isn't yet); a release without one opens its page. */
  async #download(): Promise<void> {
    const latest = this.#state.latest
    if (!latest) return
    if (!latest.asset) return this.#options.openExternal(latest.url)
    if (await this.#fetch(latest.version, latest.asset.url, latest.asset.size)) await this.#options.installer.install(this.#fileOf(latest.version))
  }

  /** With automatic downloads on, starts fetching the offered DMG; one already in Downloads counts as downloaded. */
  #prepare(): void {
    const latest = this.#state.latest
    if (!latest?.asset || this.#state.status !== "available") return
    if (this.#complete(latest.version, latest.asset.size)) {
      this.#dispatch({ type: "download-started", version: latest.version })
      this.#dispatch({ type: "downloaded", version: latest.version })
      return
    }
    if (this.#state.autoDownload) void this.#fetch(latest.version, latest.asset.url, latest.asset.size)
  }

  #fileOf(version: string): string {
    return path.join(this.#options.downloadsDir, dmgName(version, this.#options.arch))
  }

  /**
   * A file in Downloads with the DMG's name and the size GitHub gave. Without a size (or `known`: this
   * app downloaded it) it can't be told from a file of the user's own with the same name, so it doesn't count.
   */
  #complete(version: string, size: number, known = false): boolean {
    try {
      const stat = fs.statSync(this.#fileOf(version))
      return stat.isFile() && (size > 0 ? stat.size === size : known)
    } catch {
      return false
    }
  }

  /** The DMG for `version` in Downloads: true once it's there, false when the download failed. */
  #fetch(version: string, url: string, size: number): Promise<boolean> {
    if (this.#state.downloaded === version && this.#complete(version, size, true)) return Promise.resolve(true)
    const running = this.#downloads.get(version)
    if (running) return running
    const file = this.#fileOf(version)
    const download = (async () => {
      this.#dispatch({ type: "download-started", version })
      try {
        fs.mkdirSync(this.#options.downloadsDir, { recursive: true })
        await this.#options.fetchFile(url, file, size, (progress) => this.#dispatch({ type: "download-progress", version, progress }))
        this.#dispatch({ type: "downloaded", version })
        return true
      } catch (error) {
        // Nothing to clean up: fetchFile writes `<file>.part` and removes it itself, so a file of the
        // user's own with the DMG's name stays as it was.
        this.#dispatch({ type: "download-failed", version, message: error instanceof Error ? error.message : String(error) })
        return false
      } finally {
        this.#downloads.delete(version)
      }
    })()
    this.#downloads.set(version, download)
    return download
  }

  #dispatch(event: UpdateEvent): void {
    const before = this.#state
    this.#state = updateReducer(before, event)
    if (this.#state === before) return
    this.#save()
    for (const listener of this.#listeners) listener(this.#state)
  }

  /** Writes the settings when they changed. */
  #save(): void {
    const text = JSON.stringify(settingsOf(this.#state))
    if (text === this.#saved) return
    try {
      this.#options.settings.write(text)
      this.#saved = text
    } catch {}
  }
}
