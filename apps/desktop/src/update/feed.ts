// Where Cello.app reads its releases from (CEL-140): GitHub's REST API, without a token. Unauthenticated
// calls get 60 an hour per IP, so the app asks at launch, every 4 hours and on Check now, sends the ETag
// it got (a 304 doesn't count against the limit), and after a rate-limit answer doesn't ask again until
// GitHub says it may.

import { RELEASE_URL_PREFIX } from "@cello/shared/updates"

/** What the updater reads releases from; the e2e tests serve a fake one (CELLO_UPDATE_FEED). */
export interface ReleaseFeed {
  /** GitHub's release list as JSON (parsed by `parseReleases`); throws an Error that says why it couldn't. */
  read(): Promise<unknown>
}

export const RELEASES_URL = "https://api.github.com/repos/lnmunhoz/cello/releases"

/**
 * Where the app reads releases from, and which addresses it trusts in them (`parseReleases`); null when
 * it doesn't check. The packaged app always reads GitHub's list and trusts only the repository's
 * addresses: CELLO_UPDATE_FEED can't point it elsewhere. Packaged Cello Dev (`checksUpdates` false, CEL-149)
 * checks nothing. An unpackaged build (`bun run dev`, the e2e tests) checks only the test feed
 * CELLO_UPDATE_FEED names, and trusts that feed's own origin for its downloads too.
 */
export const feedFor = (
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  checksUpdates: boolean,
): { readonly url: string; readonly trusted: ReadonlyArray<string> } | null => {
  if (isPackaged) return checksUpdates ? { url: RELEASES_URL, trusted: [RELEASE_URL_PREFIX] } : null
  const test = URL.parse(env.CELLO_UPDATE_FEED ?? "")
  if (!test || (test.protocol !== "http:" && test.protocol !== "https:")) return null
  return { url: test.href, trusted: [RELEASE_URL_PREFIX, `${test.origin}/`] }
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** When a rate-limited answer says to ask again; null when it isn't one. */
const retryAt = (response: Response, now: number): number | null => {
  if (response.status !== 403 && response.status !== 429) return null
  const after = Number(response.headers.get("retry-after"))
  if (after > 0) return now + after * 1000
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"))
    return reset > 0 ? reset * 1000 : now + 60 * 60 * 1000
  }
  // GitHub's secondary limit: a 403 or 429 with neither header; a minute, as its docs say.
  return response.status === 429 ? now + 60 * 1000 : null
}

export const githubFeed = (
  url: string,
  options: { readonly fetch?: typeof globalThis.fetch; readonly now?: () => number } = {},
): ReleaseFeed => {
  const fetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  let etag: string | null = null
  let last: unknown = null
  let blockedUntil = 0
  return {
    async read() {
      if (now() < blockedUntil) throw new Error(`GitHub's rate limit: next check after ${clock(blockedUntil)}`)
      const address = new URL(url)
      if (!address.searchParams.has("per_page")) address.searchParams.set("per_page", "50")
      let response: Response
      try {
        response = await fetch(address.href, {
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "Cello.app",
            ...(etag ? { "if-none-match": etag } : {}),
          },
        })
      } catch (error) {
        throw new Error(`Couldn't reach GitHub (${error instanceof Error ? error.message : String(error)})`)
      }
      if (response.status === 304 && last !== null) return last
      const retry = retryAt(response, now())
      if (retry !== null) {
        blockedUntil = retry
        throw new Error(`GitHub's rate limit: next check after ${clock(retry)}`)
      }
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
      last = await response.json()
      etag = response.headers.get("etag")
      return last
    },
  }
}
