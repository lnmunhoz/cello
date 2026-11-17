import { describe, expect, it } from "vitest"
import { RELEASE_URL_PREFIX } from "@cello/shared/updates"
import { feedFor, githubFeed, RELEASES_URL } from "./feed.ts"

type Call = { url: string; headers: Record<string, string> }

/** A fetch that answers with the next response in line and records each request. */
const fakeFetch = (responses: Array<Response | Error>) => {
  const calls: Call[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
    const next = responses.shift()
    if (!next) throw new Error("no more responses")
    if (next instanceof Error) throw next
    return next
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

describe("feedFor", () => {
  const fake = { CELLO_UPDATE_FEED: "http://127.0.0.1:9999/releases" }

  it("the packaged app reads GitHub's release list and trusts only the repository's addresses, whatever CELLO_UPDATE_FEED says", () => {
    expect(RELEASES_URL).toBe("https://api.github.com/repos/lnmunhoz/cello/releases")
    expect(feedFor({}, true, true)).toEqual({ url: RELEASES_URL, trusted: [RELEASE_URL_PREFIX] })
    expect(feedFor(fake, true, true)).toEqual({ url: RELEASES_URL, trusted: [RELEASE_URL_PREFIX] })
  })

  it("a dev build checks only a test feed (CELLO_UPDATE_FEED), whose own origin it also trusts for downloads", () => {
    expect(feedFor({}, false, true)).toBeNull()
    expect(feedFor(fake, false, true)).toEqual({ url: fake.CELLO_UPDATE_FEED, trusted: [RELEASE_URL_PREFIX, "http://127.0.0.1:9999/"] })
  })

  it("packaged Cello Dev (CEL-149) checks nothing: bun run release and package --install update it", () => {
    expect(feedFor({}, true, false)).toBeNull()
    expect(feedFor(fake, true, false)).toBeNull()
  })

  it("a test feed that isn't an http(s) address is ignored", () => {
    expect(feedFor({ CELLO_UPDATE_FEED: "file:///tmp/releases.json" }, false, true)).toBeNull()
    expect(feedFor({ CELLO_UPDATE_FEED: "not a url" }, false, true)).toBeNull()
  })
})

describe("githubFeed", () => {
  it("asks GitHub's REST API without a token, and hands back the list", async () => {
    const { fetch, calls } = fakeFetch([json([{ tag_name: "v0.5.1" }])])
    expect(await githubFeed(RELEASES_URL, { fetch, now: () => 0 }).read()).toEqual([{ tag_name: "v0.5.1" }])
    expect(calls[0]!.url).toBe(`${RELEASES_URL}?per_page=50`)
    expect(calls[0]!.headers).toMatchObject({ accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" })
    expect(calls[0]!.headers["authorization"]).toBeUndefined()
  })

  it("asks again with the ETag it got; GitHub's 304 (which doesn't count against the rate limit) gives the list it had", async () => {
    const { fetch, calls } = fakeFetch([json([{ tag_name: "v0.5.1" }], { etag: '"abc"' }), new Response(null, { status: 304 })])
    const feed = githubFeed(RELEASES_URL, { fetch, now: () => 0 })
    await feed.read()
    expect(await feed.read()).toEqual([{ tag_name: "v0.5.1" }])
    expect(calls[1]!.headers["if-none-match"]).toBe('"abc"')
  })

  it("rate limited: says until when, and doesn't ask again before then", async () => {
    let now = Date.parse("2026-11-17T10:00:00Z")
    const reset = Math.floor(Date.parse("2026-11-17T10:30:00Z") / 1000)
    const { fetch, calls } = fakeFetch([
      json({ message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }, 403),
      json([]),
    ])
    const feed = githubFeed(RELEASES_URL, { fetch, now: () => now })
    await expect(feed.read()).rejects.toThrow(/rate limit/)
    await expect(feed.read()).rejects.toThrow(/rate limit/)
    expect(calls).toHaveLength(1)
    now = reset * 1000 + 1
    expect(await feed.read()).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it("a 429 with Retry-After waits that long", async () => {
    let now = 0
    const { fetch, calls } = fakeFetch([json({}, { "retry-after": "60" }, 429), json([])])
    const feed = githubFeed(RELEASES_URL, { fetch, now: () => now })
    await expect(feed.read()).rejects.toThrow(/rate limit/)
    now = 59_000
    await expect(feed.read()).rejects.toThrow(/rate limit/)
    now = 60_000
    await feed.read()
    expect(calls).toHaveLength(2)
  })

  it("offline, or another answer: an error saying so", async () => {
    await expect(githubFeed(RELEASES_URL, { fetch: fakeFetch([new TypeError("fetch failed")]).fetch, now: () => 0 }).read()).rejects.toThrow(
      "Couldn't reach GitHub (fetch failed)",
    )
    await expect(githubFeed(RELEASES_URL, { fetch: fakeFetch([json({}, {}, 500)]).fetch, now: () => 0 }).read()).rejects.toThrow("GitHub answered 500")
  })
})
