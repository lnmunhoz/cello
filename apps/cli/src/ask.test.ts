// `cello task ask` input (a file, or inline flags) and how Lucas's answers read for the agent.
import type { Ask, Attachment } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { alreadyDeliveredText, answerLines, answerScreenshots, askResultText, askSpecFromArgs, askSpecFromFile } from "./ask.ts"
import { deliveryText } from "./inbox.ts"

const NOW = 1_800_000_000_000

describe("askSpecFromFile", () => {
  it("reads JSON: questions with options, images, a recommendation, evidence and links, paths relative to the file", () => {
    const file = "/work/scope/ask.json"
    const spec = askSpecFromFile(JSON.stringify({
      title: "Search layout",
      intro: "Two layouts.",
      questions: [
        {
          prompt: "Which layout?",
          options: [
            { label: "Peek", description: "List + preview", image: "shots/peek.png", recommended: true, because: "Long results" },
            "Palette",
          ],
        },
        { prompt: "Which extras?", kind: "any", options: ["Filters", "Recent"] },
        { prompt: "Anything else?" },
      ],
      attach: ["shots/peek.png", { path: "/abs/flow.mp4", caption: "The flow" }],
      links: ["http://127.0.0.1:4747/CEL/pages/scope", { url: "https://example.com", caption: "Ref" }],
    }), file)
    expect(spec).toEqual({
      title: "Search layout",
      intro: "Two layouts.",
      questions: [
        {
          prompt: "Which layout?",
          options: [
            { label: "Peek", description: "List + preview", image: "/work/scope/shots/peek.png", recommended: true, because: "Long results" },
            { label: "Palette" },
          ],
        },
        { prompt: "Which extras?", kind: "any", options: [{ label: "Filters" }, { label: "Recent" }] },
        { prompt: "Anything else?" },
      ],
      files: [{ path: "/work/scope/shots/peek.png" }, { path: "/abs/flow.mp4", caption: "The flow" }],
      links: [{ url: "http://127.0.0.1:4747/CEL/pages/scope" }, { url: "https://example.com", caption: "Ref" }],
    })
  })

  it("reads YAML the same way", () => {
    const yaml = ["title: Stages", "questions:", "  - prompt: Which stages?", "    kind: any", "    options: [A, B]"].join("\n")
    expect(askSpecFromFile(yaml, "/w/ask.yaml")).toMatchObject({ title: "Stages", questions: [{ prompt: "Which stages?", kind: "any", options: [{ label: "A" }, { label: "B" }] }] })
  })

  it("says what's wrong with a broken file", () => {
    expect(askSpecFromFile("{", "/w/ask.json")).toMatchObject({ error: expect.stringContaining("ask.json isn't valid JSON") })
    expect(askSpecFromFile(JSON.stringify({ title: "x" }), "/w/ask.json")).toEqual({ error: "ask.json: questions should be a list." })
    expect(askSpecFromFile(JSON.stringify({ questions: [{ prompt: "Q", kind: "maybe" }] }), "/w/ask.json")).toEqual({
      error: "ask.json: question 1's kind should be one, any or text.",
    })
    expect(askSpecFromFile(JSON.stringify({ questions: [{ prompt: "Q", options: [{ description: "no label" }] }] }), "/w/ask.json")).toEqual({
      error: "ask.json: option 1 of question 1 needs a label.",
    })
  })
})

describe("askSpecFromArgs", () => {
  it("reads one question from inline flags, in order", () => {
    const spec = askSpecFromArgs([
      "task", "ask", "CEL-43", "--title", "Search layout",
      "--question", "Which layout?",
      "--option", "Peek: list + preview|Shows the highlighted result's text", "--recommend", "Peek: list + preview", "--because", "Most results are long text",
      "--option", "Palette: one line per result",
      "--attach", "shots/peek-dark.png", "--caption", "Peek, dark",
      "--link", "http://127.0.0.1:4747/CEL/pages/cel-43-scope",
      "--wait",
    ], "/work")
    expect(spec).toEqual({
      title: "Search layout",
      intro: null,
      questions: [{
        prompt: "Which layout?",
        options: [
          { label: "Peek: list + preview", description: "Shows the highlighted result's text", recommended: true, because: "Most results are long text" },
          { label: "Palette: one line per result" },
        ],
      }],
      files: [{ path: "/work/shots/peek-dark.png", caption: "Peek, dark" }],
      links: [{ url: "http://127.0.0.1:4747/CEL/pages/cel-43-scope" }],
    })
  })

  it("takes a kind, and several questions each with its own options", () => {
    const spec = askSpecFromArgs(["--question", "A?", "--kind", "any", "--option", "x", "--option", "y", "--question", "B?", "--kind", "text"], "/w")
    expect(spec).toMatchObject({ questions: [{ prompt: "A?", kind: "any", options: [{ label: "x" }, { label: "y" }] }, { prompt: "B?", kind: "text" }] })
  })

  it("refuses flags out of place", () => {
    expect(askSpecFromArgs(["--option", "x"], "/w")).toEqual({ error: "--option belongs to a question: put it after --question." })
    expect(askSpecFromArgs(["--question", "A?", "--option", "x", "--recommend", "y"], "/w")).toEqual({
      error: "--recommend \"y\" names no --option of \"A?\" before it; use the option's label.",
    })
    expect(askSpecFromArgs(["--question", "A?", "--option", "x", "--because", "why"], "/w")).toEqual({
      error: "--because says why you recommend an option: put it right after --recommend.",
    })
    expect(askSpecFromArgs(["--question", "A?", "--kind", "maybe"], "/w")).toMatchObject({ error: expect.stringContaining("--kind is one") })
  })
})

const shot = (id: string, name: string): Attachment => ({
  id, taskId: "t1", reviewId: null, askId: "k1", kind: "image", name, url: null, caption: "", mime: "image/png", bytes: 10,
  hasPoster: false, actorId: "human", sessionId: null, createdAt: NOW, deletedAt: null,
})

const ask: Ask = {
  id: "k1",
  taskId: "t1",
  title: "Search layout",
  intro: "",
  questions: [
    {
      id: "q1", prompt: "Which layout?", kind: "one", options: [
        { id: "q1o1", label: "Peek", description: "", imageId: null, recommended: true, because: "Long results" },
        { id: "q1o2", label: "Palette", description: "", imageId: null, recommended: false, because: "" },
      ],
    },
    {
      id: "q2", prompt: "Which extras?", kind: "any", options: [
        { id: "q2o1", label: "Filters", description: "", imageId: null, recommended: false, because: "" },
        { id: "q2o2", label: "Recent", description: "", imageId: null, recommended: false, because: "" },
      ],
    },
    { id: "q3", prompt: "Anything else?", kind: "text", options: [] },
  ],
  attachments: [],
  actorId: "agent",
  sessionId: "s1",
  author: { name: "Claude Code", session: "2fd0505c" },
  state: "answered",
  createdAt: NOW - 600_000,
  answeredAt: NOW - 120_000,
  answers: {
    questions: [
      { questionId: "q1", optionIds: ["q1o1"], none: false, comment: "Narrower preview.\nAnd a border.", attachments: [shot("a1", "image.png")] },
      { questionId: "q2", optionIds: [], none: true, comment: "Neither for now", attachments: [] },
      { questionId: "q3", optionIds: [], none: false, comment: "Ship it", attachments: [] },
    ],
    note: "Thanks",
    noteAttachments: [shot("a2", "drop.webp")],
  },
  withdrawnAt: null,
  withdrawnBy: null,
}

describe("Lucas's answers, as the agent reads them", () => {
  it("names each screenshot by what it answers", () => {
    expect(answerScreenshots(ask).map((s) => [s.attachment.id, s.fileName])).toEqual([["a1", "q1-1.png"], ["a2", "note-1.webp"]])
  })

  it("lists each question with the picks, the comment and the screenshots' paths, then the note", () => {
    const files = new Map([["a1", "/tmp/cello-answers/k1/q1-1.png"]])
    expect(answerLines(ask, files)).toEqual([
      "1. Which layout?",
      "   Picked: Peek (your recommendation)",
      "   Comment: Narrower preview.",
      "   And a border.",
      "   Screenshot: /tmp/cello-answers/k1/q1-1.png",
      "",
      "2. Which extras?",
      "   Picked: None of these",
      "   Comment: Neither for now",
      "",
      "3. Anything else?",
      "   Comment: Ship it",
      "",
      "Note: Thanks",
      "Screenshot: /attachments/a2",
    ])
  })

  it("--wait prints who answered and what to do next; a withdrawn ask says there are no answers", () => {
    const text = askResultText(ask, "CEL-43", "Lucas", new Map(), NOW)
    expect(text.split("\n")[0]).toBe("Lucas answered \"Search layout\" on CEL-43, 2m ago:")
    expect(text).toContain("CEL-43 is back in progress: carry on with these answers.")
    expect(askResultText({ ...ask, state: "withdrawn", answers: null, withdrawnAt: NOW - 60_000 }, "CEL-43", "Lucas", new Map(), NOW))
      .toBe("CEL-43's questions \"Search layout\" were withdrawn 1m ago; there are no answers.")
  })

  it("a wait whose answers already reached the session (the hook took them during a restart) says so in one line, and how to see them again", () => {
    expect(alreadyDeliveredText(ask, "CEL-43", { via: "hook", at: NOW - 3 * 60_000 }, NOW))
      .toBe("The answers to \"Search layout\" on CEL-43 already reached this session (through the hook, 3m ago). `cello task answers CEL-43` shows them again.")
    expect(alreadyDeliveredText(ask, "CEL-43", { via: "inbox", at: NOW }, NOW)).toContain("(through `cello inbox`, just now)")
    expect(alreadyDeliveredText(ask, "CEL-43", { via: "wait", at: NOW }, NOW)).toContain("(through an earlier wait, just now)")
    expect(alreadyDeliveredText(ask, "CEL-43", { via: null, at: NOW - 2 * 3_600_000 }, NOW)).toContain("already reached this session (2h ago).")
  })

  it("the hook delivers answers with the same lines, and says the task is back in progress", () => {
    const text = deliveryText([{
      id: "i1", kind: "answers", taskId: "t1", taskKey: "CEL-43", taskTitle: "Search", author: "Lucas", createdAt: NOW - 60_000, readAt: null, ask,
    }], NOW, new Map([["a1", "/tmp/q1-1.png"]]))
    expect(text.split("\n").slice(0, 5)).toEqual([
      "New in Cello for you: answers to the questions you asked:",
      "",
      "CEL-43  Search",
      "  Lucas answered your questions \"Search layout\", 1m ago",
      "    1. Which layout?",
    ])
    expect(text).toContain("       Screenshot: /tmp/q1-1.png")
    expect(text.split("\n").at(-1)).toBe(
      "CEL-43 is back in progress: carry on with Lucas's answers (the screenshots are files you can open). If something is unclear, ask on the card again with `cello task ask`.",
    )
  })
})
