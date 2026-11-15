import type { SearchHit, SearchResults } from "@cello/contract/search"
import { describe, expect, it } from "vitest"
import { bracketed, kindsOf, searchText } from "./search.ts"

const NOW = 1_763_200_000_000
const HOUR = 3_600_000

const hit = (fields: Partial<SearchHit> & Pick<SearchHit, "kind" | "title">): SearchHit => ({
  id: "x",
  projectKey: "CEL",
  taskId: null,
  taskKey: null,
  titleRanges: [],
  snippet: "",
  snippetRanges: [],
  text: "",
  textRanges: [],
  author: null,
  at: NOW - HOUR,
  status: null,
  decision: null,
  docKind: null,
  slug: null,
  color: null,
  ...fields,
})

const results = (fields: Partial<SearchResults>): SearchResults => ({ query: "evidence", terms: ["evidence"], key: null, jump: null, groups: [], ...fields })

describe("cello search's text", () => {
  it("brackets the matched words", () => {
    expect(bracketed("The evidence video", [[4, 12]])).toBe("The [evidence] video")
    expect(bracketed("plain", [])).toBe("plain")
  })

  it("prints each group with a count, one line per hit with its key, and the snippet under it", () => {
    const text = searchText(results({
      groups: [
        {
          kind: "task",
          total: 2,
          hits: [
            hit({ kind: "task", taskKey: "CEL-12", title: "Evidence in review packets", titleRanges: [[0, 8]], status: "In Review" }),
            hit({ kind: "task", taskKey: "CEL-9", title: "Record the flow", status: "Todo", snippet: "The evidence goes in the packet.", snippetRanges: [[4, 12]] }),
          ],
        },
        {
          kind: "comment",
          total: 3,
          hits: [hit({ kind: "comment", taskKey: "CEL-9", title: "Record the flow", author: "Lucas", snippet: "The evidence video stops early.", snippetRanges: [[4, 12]] })],
        },
        {
          kind: "packet",
          total: 1,
          hits: [hit({ kind: "packet", taskKey: "CEL-12", title: "Evidence in review packets", author: "Claude Code", decision: "sent_back", snippet: "Evidence plays inline", snippetRanges: [[0, 8]] })],
        },
        {
          kind: "document",
          total: 1,
          hits: [hit({ kind: "document", title: "Evidence videos", titleRanges: [[0, 8]], docKind: "doc", slug: "evidence-videos", author: "Claude Code", at: NOW - 2 * HOUR })],
        },
        { kind: "project", total: 1, hits: [hit({ kind: "project", projectKey: "THAI", title: "Thai Lookup" })] },
        { kind: "label", total: 1, hits: [hit({ kind: "label", projectKey: "", title: "evidence" , titleRanges: [[0, 8]] })] },
      ],
    }), { now: NOW, scope: "CEL" })
    expect(text.split("\n")).toEqual([
      "Tasks (2)",
      "  CEL-12  In Review  [Evidence] in review packets",
      "  CEL-9   Todo       Record the flow",
      "          The [evidence] goes in the packet.",
      "Comments (1 of 3)",
      "  CEL-9  Lucas, 1h ago, on Record the flow",
      "         The [evidence] video stops early.",
      "Review packets (1)",
      "  CEL-12  Claude Code, 1h ago, sent back, on Evidence in review packets",
      "          [Evidence] plays inline",
      "Pages and docs (1)",
      "  evidence-videos  doc  [Evidence] videos  · Claude Code, 2h ago",
      "Projects (1)",
      "  THAI  Thai Lookup",
      "Labels (1)",
      "  [evidence]",
      "",
      "More: `--limit 20` shows more per kind; `--kind comment` shows only one kind.",
    ])
  })

  it("a key: the task to go to on top, then what mentions it", () => {
    const text = searchText(results({
      query: "CEL-15",
      terms: [],
      key: "CEL-15",
      jump: hit({ kind: "task", taskKey: "CEL-15", title: "Comments reach the agent", status: "In Progress" }),
      groups: [{ kind: "task", total: 1, hits: [hit({ kind: "task", taskKey: "CEL-18", title: "Review page", status: "Todo", snippet: "Blocked on CEL-15: the note", snippetRanges: [[11, 17]] })] }],
    }), { now: NOW, scope: "CEL" })
    expect(text.split("\n")).toEqual([
      "CEL-15  In Progress  Comments reach the agent",
      "",
      "Mentions CEL-15",
      "Tasks (1)",
      "  CEL-18  Todo  Review page",
      "          Blocked on [CEL-15]: the note",
    ])
  })

  it("nothing found says where it looked", () => {
    expect(searchText(results({ query: "zebra", terms: ["zebra"] }), { now: NOW, scope: "CEL" }))
      .toBe("Nothing in CEL matches \"zebra\". Search looks at task keys, titles and descriptions, comments, review packets, docs, projects and labels.")
    expect(searchText(results({ query: "CEL-99", terms: [], key: "CEL-99" }), { now: NOW, scope: "CEL" }))
      .toBe("No task CEL-99 in CEL, and nothing mentions it.")
  })
})

describe("--kind", () => {
  it("takes one kind or several, by name, with page or doc for documents", () => {
    expect(kindsOf("task")).toEqual(["task"])
    expect(kindsOf(" Comment, packet ,page")).toEqual(["comment", "packet", "document"])
    expect(kindsOf("doc,spec,project,label")).toEqual(["document", "project", "label"])
  })

  it("names the real kinds when one is unknown", () => {
    expect(() => kindsOf("task,issue")).toThrow('No kind "issue". Kinds: task, comment, packet, page, project, label.')
  })
})
