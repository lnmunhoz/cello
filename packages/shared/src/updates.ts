// Cello.app's updates (CEL-140): which GitHub release a channel offers, and the state the app shows.
// Pure, so the rules are tested once here: the desktop app's main process (apps/desktop/src/update/
// Updater.ts) runs the checks and downloads and keeps an `UpdateState` with `updateReducer`; the board
// (apps/web/src/updates/) shows it, through the preload bridge.
//
// The feed is GitHub's release list (`GET /repos/lnmunhoz/cello/releases`), not electron-updater's
// metadata: it works unsigned. Two channels:
// - Stable: releases only (`v0.5.1`), what `bun run release` makes.
// - Preview: prereleases too (`v0.6.0-beta.1`, `bun run release -- preminor --preid beta`), and any
//   stable release that's newer than them.

// ---- versions (semver, prerelease-aware) ----

export interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** The prerelease's dot-separated parts (`beta.2` → ["beta", 2]); empty for a release. */
  readonly pre: ReadonlyArray<string | number>
}

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/

/** `v0.5.1`, `0.6.0-beta.2` (build metadata ignored); null for anything else. */
export const parseVersion = (text: string): Version | null => {
  const match = SEMVER.exec(text.trim())
  if (!match) return null
  const pre = match[4] ? match[4].split(".").map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part)) : []
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre }
}

const comparePre = (a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): number => {
  // A release outranks its prereleases.
  if (a.length === 0 || b.length === 0) return b.length - a.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    // Numeric parts rank below alphanumeric ones, and compare as numbers.
    if (typeof x === "number" && typeof y === "number") return x - y
    if (typeof x === "number") return -1
    if (typeof y === "number") return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Semver precedence: negative when `a` is older than `b`. A version that doesn't parse ranks below every other. */
export const compareVersions = (a: string, b: string): number => {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0)
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || comparePre(x.pre, y.pre)
}

export const isPrerelease = (version: string): boolean => (parseVersion(version)?.pre.length ?? 0) > 0

// ---- releases ----

export type Channel = "stable" | "preview"
export const CHANNELS: ReadonlyArray<Channel> = ["stable", "preview"]
export const CHANNEL_NAMES: Readonly<Record<Channel, string>> = { stable: "Stable", preview: "Preview" }

export interface ReleaseAsset {
  readonly name: string
  /** Where it downloads from (GitHub's `browser_download_url`). */
  readonly url: string
  readonly size: number
}

export interface Release {
  /** Without the v: `0.5.1`. */
  readonly version: string
  readonly tag: string
  readonly name: string
  /** The release's notes: its CHANGELOG.md section, as markdown. */
  readonly notes: string
  readonly prerelease: boolean
  readonly publishedAt: number | null
  /** The release's page on GitHub. */
  readonly url: string
  readonly assets: ReadonlyArray<ReleaseAsset>
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const text = (value: unknown): string => (typeof value === "string" ? value : "")

/**
 * Where a release's page and downloads may be (CEL-140): only under the repository on GitHub. Download
 * fetches an asset's address and the release's page opens in the browser, so the feed's answer never
 * picks the host or the scheme.
 */
export const RELEASE_URL_PREFIX = "https://github.com/lnmunhoz/cello/"

/** `url`, normalized (`..` resolved), when it's under one of `trusted`; null otherwise. */
const trustedUrl = (url: string, trusted: ReadonlyArray<string>): string | null => {
  const href = URL.parse(url)?.href
  return href && trusted.some((prefix) => href.startsWith(prefix)) ? href : null
}

const releaseOf = (value: unknown, trusted: ReadonlyArray<string>): Release | null => {
  const raw = record(value)
  if (!raw || raw["draft"] === true) return null
  const tag = text(raw["tag_name"])
  const parsed = parseVersion(tag)
  if (!parsed) return null
  const page = trustedUrl(text(raw["html_url"]), trusted)
  if (!page) return null
  const version = tag.replace(/^v/, "").replace(/\+.*$/, "")
  const published = Date.parse(text(raw["published_at"]))
  const assets = (Array.isArray(raw["assets"]) ? raw["assets"] : []).flatMap((asset) => {
    const a = record(asset)
    const name = text(a?.["name"])
    const url = trustedUrl(text(a?.["browser_download_url"]), trusted)
    return name && url ? [{ name, url, size: typeof a?.["size"] === "number" ? a["size"] : 0 }] : []
  })
  return {
    version,
    tag,
    name: text(raw["name"]) || `Cello ${tag}`,
    notes: text(raw["body"]),
    // A tag like a prerelease is one even when GitHub's flag says otherwise.
    prerelease: raw["prerelease"] === true || parsed.pre.length > 0,
    publishedAt: Number.isNaN(published) ? null : published,
    url: page,
    assets,
  }
}

/**
 * GitHub's release list, read leniently: drafts, tags that aren't versions, and releases whose page isn't
 * under `trusted` are left out, as are assets that don't download from under it; newest version first.
 * `trusted` is the repository on GitHub, plus the e2e tests' local feed in a dev build.
 */
export const parseReleases = (json: unknown, trusted: ReadonlyArray<string> = [RELEASE_URL_PREFIX]): Release[] =>
  (Array.isArray(json) ? json : [])
    .flatMap((value) => releaseOf(value, trusted) ?? [])
    .sort((a, b) => compareVersions(b.version, a.version))

const onChannel = (release: Release, channel: Channel) => channel === "preview" || (!release.prerelease && !isPrerelease(release.version))

/** The newest release a channel takes; null when there's none. */
export const newestFor = (releases: ReadonlyArray<Release>, channel: Channel): Release | null =>
  releases.filter((r) => onChannel(r, channel)).sort((a, b) => compareVersions(b.version, a.version))[0] ?? null

/**
 * The release to offer the app running `current` on `channel`: the channel's newest when it's newer. A
 * preview build moved back to Stable is offered the newest stable even when that's older: a downgrade
 * on purpose, as T3 Code does.
 */
export const offerFor = (current: string, channel: Channel, releases: ReadonlyArray<Release>): Release | null => {
  const newest = newestFor(releases, channel)
  if (!newest) return null
  const order = compareVersions(newest.version, current)
  if (order > 0) return newest
  if (channel === "stable" && isPrerelease(current) && order !== 0) return newest
  return null
}

/** How the Releases page marks a release: the one running, newer ones on the channel as available. */
export const releaseMark = (release: Release, current: string, channel: Channel): "running" | "available" | null => {
  const order = compareVersions(release.version, current)
  if (order === 0) return "running"
  return order > 0 && onChannel(release, channel) ? "available" : null
}

/** The DMG the release workflow attaches for one Mac architecture (scripts/release/artifacts.ts names it). */
export const dmgName = (version: string, arch: string): string => `Cello-v${version}-mac-${arch}.dmg`

/** This Mac's DMG in a release (`arch` is `process.arch`: arm64 or x64); null when it has none. */
export const dmgFor = (release: Release, arch: string): ReleaseAsset | null =>
  release.assets.find((asset) => asset.name === dmgName(release.version, arch)) ?? null

// ---- the settings the app keeps (userData/updates.json) ----

export interface UpdateSettings {
  readonly channel: Channel
  /** Download a new release's DMG in the background, so Download opens it at once. */
  readonly autoDownload: boolean
  /** The last version the "is available" toast was shown for. */
  readonly notified: string | null
  /** The last version the app acknowledged running: tells a launch after an update. */
  readonly lastRun: string | null
}

export const parseUpdateSettings = (json: string | null): UpdateSettings => {
  let raw: Record<string, unknown> | null = null
  try {
    raw = json === null ? null : record(JSON.parse(json))
  } catch {}
  const version = (value: unknown) => (typeof value === "string" && parseVersion(value) ? value : null)
  return {
    channel: raw?.["channel"] === "preview" ? "preview" : "stable",
    autoDownload: typeof raw?.["autoDownload"] === "boolean" ? raw["autoDownload"] : true,
    notified: version(raw?.["notified"]),
    lastRun: version(raw?.["lastRun"]),
  }
}

/**
 * What a launch of `current` makes of the version that ran last: `updatedFrom`, when it's newer ("Updated
 * to 0.5.1", until acknowledged), and the `lastRun` to keep. The first launch ever says nothing; neither
 * does going back to an older version.
 */
export const afterLaunch = (lastRun: string | null, current: string): { updatedFrom: string | null; lastRun: string } =>
  lastRun !== null && compareVersions(current, lastRun) > 0 ? { updatedFrom: lastRun, lastRun } : { updatedFrom: null, lastRun: current }

// ---- the state the app shows ----

export type UpdateStatus = "up-to-date" | "available" | "downloading" | "downloaded" | "error"

/** The release on offer, with what the app needs to show and fetch it. */
export interface UpdateInfo {
  readonly version: string
  readonly tag: string
  readonly name: string
  readonly url: string
  readonly notes: string
  readonly prerelease: boolean
  readonly publishedAt: number | null
  /** This Mac's DMG; null when the release has none (Download opens the release's page then). */
  readonly asset: ReleaseAsset | null
  /** Older than the running version: a preview build moved back to Stable. */
  readonly downgrade: boolean
}

export interface UpdateState {
  /** The running version. */
  readonly current: string
  readonly arch: string
  readonly channel: Channel
  readonly autoDownload: boolean
  readonly status: UpdateStatus
  /** A check is running. */
  readonly checking: boolean
  /** When the last check that worked ended; null before one has. */
  readonly checkedAt: number | null
  readonly latest: UpdateInfo | null
  /** The offered release's notes (`latest.notes`). */
  readonly notes: string | null
  /** Why the last check or download failed; null when it worked. */
  readonly error: string | null
  /** 0 to 1 while downloading. */
  readonly progress: number | null
  /** The version being downloaded, and the one downloaded (its DMG is in Downloads). */
  readonly downloading: string | null
  readonly downloaded: string | null
  /** Every release from the last check that worked, newest first: the Releases page. */
  readonly releases: ReadonlyArray<Release>
  readonly notified: string | null
  readonly lastRun: string
  /** The version that ran before this one, for "Updated to …" until it's acknowledged. */
  readonly updatedFrom: string | null
}

export type UpdateEvent =
  | { readonly type: "check-started" }
  | { readonly type: "checked"; readonly releases: ReadonlyArray<Release>; readonly at: number }
  | { readonly type: "check-failed"; readonly message: string; readonly at: number }
  | { readonly type: "channel"; readonly channel: Channel }
  | { readonly type: "auto-download"; readonly on: boolean }
  | { readonly type: "download-started"; readonly version: string }
  | { readonly type: "download-progress"; readonly version: string; readonly progress: number }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "download-failed"; readonly version: string; readonly message: string }
  | { readonly type: "acknowledged"; readonly what: "notify" | "updated"; readonly version: string }

export const initialUpdateState = (options: { readonly current: string; readonly arch: string; readonly settings: UpdateSettings }): UpdateState => {
  const { current, arch, settings } = options
  const launch = afterLaunch(settings.lastRun, current)
  return {
    current,
    arch,
    channel: settings.channel,
    autoDownload: settings.autoDownload,
    status: "up-to-date",
    checking: false,
    checkedAt: null,
    latest: null,
    notes: null,
    error: null,
    progress: null,
    downloading: null,
    downloaded: null,
    releases: [],
    notified: settings.notified,
    lastRun: launch.lastRun,
    updatedFrom: launch.updatedFrom,
  }
}

const infoOf = (release: Release, state: Pick<UpdateState, "current" | "arch">): UpdateInfo => ({
  version: release.version,
  tag: release.tag,
  name: release.name,
  url: release.url,
  notes: release.notes,
  prerelease: release.prerelease,
  publishedAt: release.publishedAt,
  asset: dmgFor(release, state.arch),
  downgrade: compareVersions(release.version, state.current) < 0,
})

/** The offer and status that follow from the releases, channel and downloads. */
const settle = (state: UpdateState, lastCheckFailed: boolean): UpdateState => {
  const offer = offerFor(state.current, state.channel, state.releases)
  const latest = offer ? infoOf(offer, state) : null
  const status: UpdateStatus = latest
    ? state.downloaded === latest.version
      ? "downloaded"
      : state.downloading === latest.version
        ? "downloading"
        : "available"
    : lastCheckFailed && state.checkedAt === null
      ? "error"
      : "up-to-date"
  return { ...state, latest, notes: latest?.notes ?? null, status, progress: status === "downloading" ? state.progress : null }
}

export const updateReducer = (state: UpdateState, event: UpdateEvent): UpdateState => {
  switch (event.type) {
    case "check-started":
      return { ...state, checking: true }
    case "checked":
      return settle({ ...state, checking: false, checkedAt: event.at, releases: [...event.releases], error: null }, false)
    case "check-failed":
      // Quietly: what the last good check found stays.
      return settle({ ...state, checking: false, error: event.message }, true)
    case "channel":
      return settle({ ...state, channel: event.channel }, state.status === "error")
    case "auto-download":
      return { ...state, autoDownload: event.on }
    case "download-started":
      return settle({ ...state, downloading: event.version, progress: 0, error: null }, false)
    case "download-progress":
      return state.downloading === event.version ? { ...state, progress: Math.min(1, Math.max(0, event.progress)) } : state
    case "downloaded":
      if (state.downloading !== event.version) return state
      return settle({ ...state, downloading: null, downloaded: event.version }, false)
    case "download-failed":
      if (state.downloading !== event.version) return state
      return settle({ ...state, downloading: null, error: `Couldn't download ${event.version}: ${event.message}` }, false)
    case "acknowledged":
      return event.what === "notify"
        ? { ...state, notified: event.version }
        : { ...state, updatedFrom: null, lastRun: state.current }
  }
}

/** The settings to keep, from the state. */
export const settingsOf = (state: UpdateState): UpdateSettings => ({
  channel: state.channel,
  autoDownload: state.autoDownload,
  notified: state.notified,
  lastRun: state.lastRun,
})

/** The version to show "Cello X is available" for, once: an offer the toast hasn't been shown for. */
export const shouldNotify = (state: UpdateState): string | null =>
  state.latest && state.latest.version !== state.notified ? state.latest.version : null

/**
 * The sidebar footer's line: "Cello 0.5.0 · Stable · up to date", or "Update available: 0.5.1". Before
 * a check has worked (or while offline) it claims nothing: "Cello 0.5.0 · Stable".
 */
export const updateLine = (state: UpdateState): string => {
  if (state.latest) return state.latest.downgrade ? `Stable release: ${state.latest.version}` : `Update available: ${state.latest.version}`
  const name = `Cello ${state.current} · ${CHANNEL_NAMES[state.channel]}`
  return state.status === "up-to-date" && state.checkedAt !== null ? `${name} · up to date` : name
}

// ---- what the board asks the app (the preload's bridge → main) ----

export type UpdateCommand =
  | { readonly kind: "check" }
  /** Download: opens the downloaded DMG, downloading it first if needed, or the release's page when it has none. */
  | { readonly kind: "download" }
  | { readonly kind: "channel"; readonly channel: Channel }
  | { readonly kind: "auto-download"; readonly on: boolean }
  | { readonly kind: "acknowledge"; readonly what: "notify" | "updated"; readonly version: string }

/** A command from the board, checked field by field; null for anything else. */
export const parseUpdateCommand = (value: unknown): UpdateCommand | null => {
  const raw = record(value)
  switch (raw?.["kind"]) {
    case "check":
    case "download":
      return { kind: raw["kind"] }
    case "channel":
      return raw["channel"] === "stable" || raw["channel"] === "preview" ? { kind: "channel", channel: raw["channel"] } : null
    case "auto-download":
      return typeof raw["on"] === "boolean" ? { kind: "auto-download", on: raw["on"] } : null
    case "acknowledge":
      return (raw["what"] === "notify" || raw["what"] === "updated") && typeof raw["version"] === "string" && parseVersion(raw["version"])
        ? { kind: "acknowledge", what: raw["what"], version: raw["version"] }
        : null
    default:
      return null
  }
}
