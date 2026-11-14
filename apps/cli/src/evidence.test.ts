import { describe, expect, it } from "vitest"
import { evidenceFromArgs } from "./evidence.ts"

const cwd = "/repo/app"

describe("evidenceFromArgs", () => {
  it("keeps --attach and --link in order, each --caption going to the one before it", () => {
    const args = [
      "task", "submit", "CEL-7", "--summary", "Done", "--step", "Open it",
      "--attach", "e2e/videos/flow.mp4", "--caption", "The whole flow",
      "--attach=/tmp/shot.png",
      "--link", "https://github.com/x/y/pull/1", "--caption=The PR",
      "--step", "--attach looks like a flag but is a step",
    ]
    expect(evidenceFromArgs(args, cwd)).toEqual({
      files: [
        { path: "/repo/app/e2e/videos/flow.mp4", caption: "The whole flow" },
        { path: "/tmp/shot.png" },
      ],
      links: [{ url: "https://github.com/x/y/pull/1", caption: "The PR" }],
    })
  })

  it("a --caption needs an --attach or --link before it, and only one each", () => {
    expect(evidenceFromArgs(["--caption", "Orphan", "--attach", "a.png"], cwd)).toEqual({
      error: "--caption describes the --attach or --link before it; put it after one.",
    })
    expect(evidenceFromArgs(["--attach", "a.png", "--caption", "One", "--caption", "Two"], cwd)).toEqual({
      error: "a.png already has a caption; give each --attach one --caption.",
    })
  })

  it("a flag missing its value is an error", () => {
    expect(evidenceFromArgs(["--attach"], cwd)).toEqual({ error: "--attach needs a value." })
  })

  it("no evidence flags give empty lists", () => {
    expect(evidenceFromArgs(["task", "submit", "CEL-7", "--json"], cwd)).toEqual({ files: [], links: [] })
  })
})
