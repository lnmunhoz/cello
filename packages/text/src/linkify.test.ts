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

describe("linkify: task keys", () => {
  const KNOWN = new Set(["CEL-3", "CEL-8", "CEL-12", "THAI-1", "XCEL-4"])
  const isTask = (key: string) => KNOWN.has(key)
  const task = (key: string) => {
    const [projectKey, number] = key.split("-")
    return { type: "task", text: key, key, projectKey, number: Number(number) }
  }

  it("finds keys next to the punctuation around them", () => {
    expect(linkify("Blocked on CEL-8, then (CEL-3) ships in CEL-12.", { isTask })).toEqual([
      text("Blocked on "),
      task("CEL-8"),
      text(", then ("),
      task("CEL-3"),
      text(") ships in "),
      task("CEL-12"),
      text("."),
    ])
    expect(linkify("CEL-3: done; CEL-8!", { isTask })).toEqual([task("CEL-3"), text(": done; "), task("CEL-8"), text("!")])
    expect(linkify("| CEL-12 | In Progress |", { isTask })).toEqual([text("| "), task("CEL-12"), text(" | In Progress |")])
  })

  it("not inside a longer word, key or number", () => {
    for (const t of ["XCEL-3", "CEL-3a", "CEL-3_b", "CEL-3-fix", "CEL-3.5", "CEL-3.md", "CEL-03", "ACEL-8", "_CEL-8", "x-CEL-8"]) {
      expect(linkify(t, { isTask })).toEqual([text(t)])
    }
    // XCEL is a project of its own: its key links, never the CEL inside it.
    expect(linkify("XCEL-4", { isTask })).toEqual([task("XCEL-4")])
  })

  it("lowercase and mixed-case keys stay text", () => {
    expect(linkify("cel-3, Cel-8 and cEL-12", { isTask })).toEqual([text("cel-3, Cel-8 and cEL-12")])
  })

  it("only keys of known projects and existing tasks link", () => {
    expect(linkify("FOO-1, CEL-999 and CEL-3", { isTask })).toEqual([text("FOO-1, CEL-999 and "), task("CEL-3")])
  })

  it("leaves keys in code spans and fenced code blocks alone", () => {
    expect(linkify("Run `cello task claim CEL-3` before CEL-8", { isTask })).toEqual([text("Run `cello task claim CEL-3` before "), task("CEL-8")])
    expect(linkify("``a ` CEL-3`` and CEL-8", { isTask })).toEqual([text("``a ` CEL-3`` and "), task("CEL-8")])
    const fenced = "Steps:\n```sh\ncello task submit CEL-3\n```\nThen CEL-8.\n~~~\nCEL-12\n~~~"
    expect(linkify(fenced, { isTask })).toEqual([text("Steps:\n```sh\ncello task submit CEL-3\n```\nThen "), task("CEL-8"), text(".\n~~~\nCEL-12\n~~~")])
    // A fence that never closes runs to the end.
    expect(linkify("CEL-3\n```\nCEL-8", { isTask })).toEqual([task("CEL-3"), text("\n```\nCEL-8")])
  })

  it("web addresses keep working: a key inside one stays part of the address", () => {
    expect(linkify("See https://github.com/lnmunhoz/cello/issues?q=CEL-3, http://localhost:4747/CEL/3 and CEL-3.", { isTask })).toEqual([
      text("See "),
      link("https://github.com/lnmunhoz/cello/issues?q=CEL-3"),
      text(", "),
      link("http://localhost:4747/CEL/3"),
      text(" and "),
      task("CEL-3"),
      text("."),
    ])
  })

  it("without a way to tell which tasks exist, keys stay text", () => {
    expect(linkify("CEL-3 https://a.dev")).toEqual([text("CEL-3 "), link("https://a.dev")])
  })
})
