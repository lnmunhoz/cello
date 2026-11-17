// A local stand-in for GitHub's release list (CEL-140), for the updater's integration test and the desktop
// e2e tests (CELLO_UPDATE_FEED points the app at it): `GET /releases` answers as
// `GET /repos/lnmunhoz/cello/releases` does, and each release's DMGs download from the same server.
import * as http from "node:http"
import type * as net from "node:net"

export interface FakeRelease {
  /** Without the v: `0.5.1`, `0.6.0-beta.1`. */
  readonly version: string
  readonly notes: string
  /** GitHub's flag; a version with a `-` is one either way. */
  readonly prerelease?: boolean
  readonly publishedAt?: string
  /** The DMG's bytes, for every architecture; omit for a release without DMGs. */
  readonly dmg?: string
}

export interface FakeReleaseFeed {
  /** The feed's address, for CELLO_UPDATE_FEED. */
  readonly url: string
  /** Every DMG request, by path. */
  readonly downloads: string[]
  /** How many times the release list was asked for. */
  readonly reads: () => number
  /** Replaces the releases it lists. */
  readonly set: (releases: ReadonlyArray<FakeRelease>) => void
  readonly close: () => Promise<void>
}

const ARCHES = ["arm64", "x64"]

export const startFakeReleaseFeed = async (initial: ReadonlyArray<FakeRelease>): Promise<FakeReleaseFeed> => {
  let releases = [...initial]
  let reads = 0
  const downloads: string[] = []
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://x")
    if (pathname === "/releases") {
      reads++
      const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
      const body = releases.map((release) => ({
        tag_name: `v${release.version}`,
        name: `Cello v${release.version}`,
        body: release.notes,
        draft: false,
        prerelease: release.prerelease ?? release.version.includes("-"),
        published_at: release.publishedAt ?? "2026-11-17T10:00:00Z",
        html_url: `https://github.com/lnmunhoz/cello/releases/tag/v${release.version}`,
        assets: release.dmg === undefined
          ? []
          : ARCHES.map((arch) => ({
              name: `Cello-v${release.version}-mac-${arch}.dmg`,
              browser_download_url: `${base}/download/Cello-v${release.version}-mac-${arch}.dmg`,
              size: Buffer.byteLength(release.dmg!),
            })),
      }))
      response.writeHead(200, { "content-type": "application/json" })
      return response.end(JSON.stringify(body))
    }
    const dmg = /^\/download\/Cello-v(.+)-mac-[a-z0-9]+\.dmg$/.exec(pathname)
    const release = dmg ? releases.find((r) => r.version === dmg[1] && r.dmg !== undefined) : undefined
    if (release) {
      downloads.push(pathname)
      response.writeHead(200, { "content-type": "application/x-apple-diskimage", "content-length": String(Buffer.byteLength(release.dmg!)) })
      return response.end(release.dmg)
    }
    response.writeHead(404)
    response.end("Not found")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/releases`,
    downloads,
    reads: () => reads,
    set: (next) => (releases = [...next]),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
