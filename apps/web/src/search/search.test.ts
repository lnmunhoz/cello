// The ⌘K bar's rules (CEL-43), without a browser: layouts, where a result goes, recent places, the
// action list, and what each layout lists for a search.
import type { SearchHit, SearchResults } from "@cello/contract/search"
import { describe, expect, it } from "vitest"
import { actionSpecs, isActionsOnly, matchActions, type ActionContext } from "./actions.ts"
import { readBarLayout, shownLayout } from "./layout.ts"
import { MAX_RECENT, readRecent, recentOf, targetOf, withRecent } from "./open.ts"
import { scopeCounts, sectionsOf } from "./sections.ts"

const hit = (fields: Partial<SearchHit> & Pick<SearchHit, "kind" | "id">): SearchHit => ({
  projectKey: "CEL",
  taskId: null,
  taskKey: null,
  title: "",
  titleRanges: [],
  snippet: "",
  snippetRanges: [],
  text: "",
  textRanges: [],
  author: null,
  at: 0,
  status: null,
  decision: null,
  docKind: null,
  slug: null,
  color: null,
  ...fields,
})

describe("the layout", () => {
  it("is Peek unless Palette was picked; Peek shows as Palette in a narrow window", () => {
    expect(readBarLayout(null)).toBe("peek")
    expect(readBarLayout("palette")).toBe("palette")
    expect(readBarLayout("junk")).toBe("peek")
    expect(shownLayout("peek", false)).toBe("peek")
    expect(shownLayout("peek", true)).toBe("palette")
    expect(shownLayout("palette", false)).toBe("palette")
  })
})

describe("opening a result", () => {
  it("a task opens in the panel, or as a full page with ⌘Enter", () => {
    expect(targetOf(hit({ kind: "task", id: "t", taskKey: "CEL-15" }), false)).toEqual({ to: "task", projectKey: "CEL", number: 15, full: false })
    expect(targetOf(hit({ kind: "task", id: "t", taskKey: "CEL-15" }), true)).toMatchObject({ full: true })
  })

  it("a comment opens its task at the comment", () => {
    expect(targetOf(hit({ kind: "comment", id: "c1", taskKey: "CEL-9" }), false)).toEqual({ to: "task", projectKey: "CEL", number: 9, full: false, comment: "c1" })
  })

  it("an open packet opens on the Review page; a decided one, or ⌘Enter, opens its task", () => {
    expect(targetOf(hit({ kind: "packet", id: "r", taskKey: "CEL-3" }), false)).toEqual({ to: "review", key: "CEL-3" })
    expect(targetOf(hit({ kind: "packet", id: "r", taskKey: "CEL-3", decision: "approved" }), false)).toMatchObject({ to: "task", number: 3 })
    expect(targetOf(hit({ kind: "packet", id: "r", taskKey: "CEL-3" }), true)).toMatchObject({ to: "task", full: true })
  })

  it("a document opens its page, a project its issues, a label Settings", () => {
    expect(targetOf(hit({ kind: "document", id: "d", slug: "scope" }), false)).toEqual({ to: "page", projectKey: "CEL", slug: "scope" })
    expect(targetOf(hit({ kind: "project", id: "p", projectKey: "THAI" }), false)).toEqual({ to: "issues", projectKey: "THAI" })
    expect(targetOf(hit({ kind: "label", id: "l", projectKey: "THAI" }), false)).toEqual({ to: "settings", projectKey: "THAI" })
  })
})

describe("recent places", () => {
  it("are what was opened, newest first, once each, at most eight", () => {
    const task = recentOf({ to: "task", projectKey: "CEL", number: 9, full: false, comment: "c1" })!
    expect(task).toEqual({ kind: "task", key: "CEL-9" })
    expect(recentOf({ to: "review", key: "CEL-3" })).toEqual({ kind: "task", key: "CEL-3" })
    expect(recentOf({ to: "settings" })).toBeNull()
    const page = recentOf({ to: "page", projectKey: "CEL", slug: "scope" })!
    let list = withRecent(withRecent([], task), page)
    expect(list).toEqual([page, task])
    list = withRecent(list, task)
    expect(list).toEqual([task, page])
    for (let n = 1; n <= 10; n++) list = withRecent(list, { kind: "task", key: `CEL-${n + 100}` })
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toEqual({ kind: "task", key: "CEL-110" })
  })

  it("read back what was saved, dropping anything unreadable", () => {
    expect(readRecent(JSON.stringify([{ kind: "task", key: "CEL-1" }, { kind: "nope" }, { kind: "project", projectKey: "THAI" }])))
      .toEqual([{ kind: "task", key: "CEL-1" }, { kind: "project", projectKey: "THAI" }])
    expect(readRecent("{broken")).toEqual([])
    expect(readRecent(null)).toEqual([])
  })
})

const CONTEXT: ActionContext = { project: { name: "Cello" }, waiting: 2, workspaces: 1, dark: false, layout: "peek", typed: "" }

describe("the actions", () => {
  it("live in one list: create, Review with its count, the project's pages, switching, sidebar, theme, layout, settings", () => {
    const specs = actionSpecs(CONTEXT)
    expect(specs.map((a) => a.id)).toEqual(["new-task", "review", "issues", "docs", "switch-project", "sidebar", "theme", "layout", "settings"])
    expect(specs.find((a) => a.id === "review")).toMatchObject({ label: "Go to Review", meta: "2 waiting" })
    expect(specs.find((a) => a.id === "new-task")).toMatchObject({ label: "Create task in Cello…", opensList: true })
    expect(specs.find((a) => a.id === "sidebar")?.shortcut).toBe("mod+b")
    expect(specs.find((a) => a.id === "theme")?.label).toBe("Switch to dark theme")
    expect(actionSpecs({ ...CONTEXT, dark: true }).find((a) => a.id === "theme")?.label).toBe("Switch to light theme")
    expect(specs.find((a) => a.id === "layout")?.label).toBe("Search with the Palette layout")
    expect(actionSpecs({ ...CONTEXT, workspaces: 2 }).map((a) => a.id)).toContain("switch-workspace")
    expect(actionSpecs({ ...CONTEXT, project: null }).map((a) => a.id)).not.toContain("new-task")
  })

  it("offer what's typed as a new task's title", () => {
    const specs = actionSpecs({ ...CONTEXT, typed: " evidence flow " })
    expect(specs[0]).toMatchObject({ id: "new-task", label: "Create task “evidence flow” in Cello", opensList: false })
    expect(matchActions(specs, "evidence flow").map((a) => a.id)).toEqual(["new-task"])
  })

  it("match the start of words in the label or keywords; > shows only actions", () => {
    const specs = actionSpecs(CONTEXT)
    expect(matchActions(specs, "rev").map((a) => a.id)).toEqual(["review"])
    expect(matchActions(specs, "rev")[0]!.titleRanges).toEqual([[6, 9]])
    expect(matchActions(specs, ">appear").map((a) => a.id)).toEqual(["theme"])
    expect(matchActions(specs, ">").length).toBe(specs.length)
    expect(isActionsOnly(" >th")).toBe(true)
    expect(isActionsOnly("the")).toBe(false)
  })
})

const results = (fields: Partial<SearchResults>): SearchResults => ({ query: "x", terms: ["x"], key: null, jump: null, groups: [], ...fields })
const many = (kind: SearchHit["kind"], n: number) => Array.from({ length: n }, (_, i) => hit({ kind, id: `${kind}${i}` }))

describe("what the bar lists for a search", () => {
  const found = results({
    groups: [
      { kind: "task", total: 9, hits: many("task", 8) },
      { kind: "comment", total: 3, hits: many("comment", 3) },
      { kind: "project", total: 1, hits: many("project", 1) },
      { kind: "label", total: 2, hits: many("label", 2) },
    ],
  })

  it("sections in order, projects and labels together; Palette keeps each short", () => {
    const peek = sectionsOf(found, "peek", "all")
    expect(peek.map((s) => [s.label, s.hits.length, s.total])).toEqual([
      ["Tasks", 8, 9],
      ["Comments", 3, 3],
      ["Projects and labels", 3, 3],
    ])
    expect(sectionsOf(found, "palette", "all").map((s) => s.hits.length)).toEqual([4, 2, 3])
  })

  it("Peek narrows to one scope; the tabs count each", () => {
    expect(sectionsOf(found, "peek", "comment").map((s) => s.label)).toEqual(["Comments"])
    expect(scopeCounts(found)).toEqual({ all: 15, task: 9, comment: 3, packet: 0, document: 0, project: 3 })
    expect(scopeCounts(null).all).toBe(0)
  })

  it("a key's mentions are one section", () => {
    const byKey = results({ key: "CEL-15", terms: [], groups: [{ kind: "task", total: 1, hits: many("task", 1) }, { kind: "comment", total: 2, hits: many("comment", 2) }] })
    expect(sectionsOf(byKey, "peek", "all")).toEqual([expect.objectContaining({ id: "mentions", label: "Mentions CEL-15", total: 3 })])
    expect(sectionsOf(results({ key: "CEL-9", terms: [] }), "peek", "all")).toEqual([])
    expect(sectionsOf(null, "peek", "all")).toEqual([])
  })
})
