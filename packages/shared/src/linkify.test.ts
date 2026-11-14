import { describe, expect, it } from "vitest"
import { linkify, shortUrl } from "./linkify.ts"

const link = (url: string) => ({ type: "link", text: url, url })
const text = (t: string) => ({ type: "text", text: t })

describe("linkify", () => {
  it("leaves text without a web address as one piece", () => {
    expect(linkify("Looks good, ship it")).toEqual([text("Looks good, ship it")])
    expect(linkify("")).toEqual([])
  })

  it("turns a bare address into a link, keeping the text around it", () => {
    expect(linkify("PR: https://github.com/lnmunhoz/cello/pull/10 is up")).toEqual([
      text("PR: "),
      link("https://github.com/lnmunhoz/cello/pull/10"),
      text(" is up"),
    ])
  })

  it("keeps query strings, fragments and ports", () => {
    expect(linkify("http://localhost:5173/CEL/3?layout=list#comments")).toEqual([link("http://localhost:5173/CEL/3?layout=list#comments")])
  })

  it("leaves the punctuation that ends a sentence out of the link", () => {
    expect(linkify("See https://claude.ai/artifact/abc.")).toEqual([text("See "), link("https://claude.ai/artifact/abc"), text(".")])
    expect(linkify("https://a.dev/x, https://b.dev/y!")).toEqual([link("https://a.dev/x"), text(", "), link("https://b.dev/y"), text("!")])
    expect(linkify('"https://a.dev/x"')).toEqual([text('"'), link("https://a.dev/x"), text('"')])
  })

  it("keeps a closing bracket the address opened, and drops one it didn't", () => {
    expect(linkify("(https://en.wikipedia.org/wiki/Cello_(instrument))")).toEqual([
      text("("),
      link("https://en.wikipedia.org/wiki/Cello_(instrument)"),
      text(")"),
    ])
    expect(linkify("[https://a.dev/x]")).toEqual([text("["), link("https://a.dev/x"), text("]")])
  })

  it("links only web addresses", () => {
    expect(linkify("javascript:alert(1) ftp://files.dev/x mailto:me@x.dev file:///etc/passwd")).toEqual([
      text("javascript:alert(1) ftp://files.dev/x mailto:me@x.dev file:///etc/passwd"),
    ])
    expect(linkify("xhttps://a.dev")).toEqual([text("xhttps://a.dev")])
    expect(linkify("https://. and http://")).toEqual([text("https://. and http://")])
  })
})

describe("shortUrl", () => {
  it("drops the scheme and a trailing slash", () => {
    expect(shortUrl("https://github.com/lnmunhoz/cello/pull/12/")).toBe("github.com/lnmunhoz/cello/pull/12")
    expect(shortUrl("http://localhost:5173/")).toBe("localhost:5173")
  })
})
