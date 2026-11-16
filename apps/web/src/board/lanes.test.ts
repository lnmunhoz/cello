import { describe, expect, it } from "vitest"
import { WORKING_LANE } from "../presence/model.ts"
import { inLaneOrder, laneDrop, laneHeadings, laneOf, stageLanes } from "./lanes.ts"

const card = (id: string, position: string, stage: string | null) => ({ id, position, stage })

describe("stageLanes", () => {
  it("groups a column by stage, in the stage list's order, keeping each lane's order; tasks without one come last", () => {
    const tasks = [card("a", "a0", "review"), card("b", "a1", null), card("c", "a2", "building"), card("d", "a3", "review")]
    expect(stageLanes(tasks).map((l) => [l.stage?.id ?? null, l.tasks.map((t) => t.id)])).toEqual([
      ["building", ["c"]],
      ["review", ["a", "d"]],
      [null, ["b"]],
    ])
  })

  it("Planning comes first, before Building (CEL-105)", () => {
    const tasks = [card("a", "a0", "building"), card("b", "a1", "planning")]
    expect(stageLanes(tasks).map((l) => l.stage?.id ?? null)).toEqual(["planning", "building"])
  })

  it("a Working lane sits after the stages and before the tasks with no stage (CEL-105)", () => {
    const tasks = [card("a", "a0", null), card("b", "a1", WORKING_LANE), card("c", "a2", "merged")]
    const lanes = stageLanes(tasks)
    expect(lanes.map((l) => [l.stage?.id ?? null, l.tasks.map((t) => t.id)])).toEqual([
      ["merged", ["c"]],
      ["working", ["b"]],
      [null, ["a"]],
    ])
    expect(lanes[1]!.stage?.label).toBe("Working")
  })

  it("leaves out empty lanes", () => {
    expect(stageLanes([card("a", "a0", "merged")]).map((l) => l.stage?.id)).toEqual(["merged"])
    expect(stageLanes([])).toEqual([])
  })
})

describe("laneOf: which lane a task of In Progress goes in (CEL-105)", () => {
  it("its stage, whatever its agent is doing", () => {
    expect(laneOf({ stage: "planning" }, true)).toBe("planning")
    expect(laneOf({ stage: "review" }, false)).toBe("review")
  })

  it("with no stage, Working while an agent on it is active", () => {
    expect(laneOf({ stage: null }, true)).toBe(WORKING_LANE)
  })

  it("with no stage and no active agent (quiet, ended, Lucas's or nobody's): no stage", () => {
    expect(laneOf({ stage: null }, false)).toBeNull()
  })
})

describe("inLaneOrder: a column's tasks lane by lane, for the board and the list alike (CEL-105)", () => {
  it("orders by each task's lane, keeping the order inside a lane, and hands back the tasks themselves", () => {
    const tasks = [card("a", "a0", null), card("b", "a1", "building"), card("c", "a2", null), card("d", "a3", "planning")]
    const active = new Set(["c"])
    const ordered = inLaneOrder(tasks, (t) => laneOf(t, active.has(t.id)))
    expect(ordered.map((t) => t.id)).toEqual(["d", "b", "c", "a"])
    expect(ordered[0]).toBe(tasks[3])
  })
})

describe("laneHeadings", () => {
  const stages: Record<string, string | null> = { c: "building", a: "review", d: "review", b: null }
  const stageOf = (id: string) => stages[id] ?? null

  it("puts a heading, with its count, above the first card of each lane", () => {
    expect([...laneHeadings(["c", "a", "d", "b"], stageOf, null)]).toEqual([
      [0, { stage: "building", count: 1 }],
      [1, { stage: "review", count: 2 }],
      [3, { stage: null, count: 1 }],
    ])
  })

  it("while a card is dragged, its lane's heading stays with the lane's other cards", () => {
    // "a" was picked up and hovers above "c": the review heading stays above "d".
    expect(laneHeadings(["a", "c", "d", "b"], stageOf, "a").get(2)).toEqual({ stage: "review", count: 2 })
    expect(laneHeadings(["a", "c", "d", "b"], stageOf, "a").has(0)).toBe(false)
  })
})

describe("laneDrop: a drop in a column split into lanes", () => {
  // The column as shown: building [c], review [a, d], no stage [b]. Positions are the manual order.
  const column = [card("a", "a0", "review"), card("b", "a1", null), card("c", "a2", "building"), card("d", "a3", "review")]

  it("inside its lane, the card goes between its lane neighbors in manual order", () => {
    // "d" dragged above "a", still in the review lane.
    expect(laneDrop({ key: "d", to: "prog", index: 1 }, ["c", "d", "a", "b"], "prog", "manual", column)).toMatchObject({
      statusId: "prog", before: null, after: "a",
    })
    // "a" dragged below "d".
    expect(laneDrop({ key: "a", to: "prog", index: 2 }, ["c", "d", "a", "b"], "prog", "manual", column)).toMatchObject({
      statusId: "prog", before: "d", after: null,
    })
  })

  it("into another lane, it snaps back: nothing to send", () => {
    // "a" (review) dropped among the building lane, above "c".
    expect(laneDrop({ key: "a", to: "prog", index: 0 }, ["a", "c", "d", "b"], "prog", "manual", column)).toBeNull()
    // "c" (building, alone in its lane) dropped below "b", in the no-stage lane.
    expect(laneDrop({ key: "c", to: "prog", index: 3 }, ["a", "d", "b", "c"], "prog", "manual", column)).toBeNull()
  })

  it("folded Needs input cards below the lanes belong to no lane: a card dropped among them snaps back", () => {
    // "w" is a Needs input card shown at the bottom of In Progress; it isn't in the column's own tasks.
    expect(laneDrop({ key: "b", to: "prog", index: 4 }, ["c", "a", "d", "w", "b"], "prog", "manual", column)).toBeNull()
  })

  it("under a sorted order, a drop inside the column changes nothing", () => {
    expect(laneDrop({ key: "d", to: "prog", index: 1 }, ["c", "d", "a", "b"], "prog", "priority", column)).toBeNull()
  })

  it("from another column, a card has no stage yet: it joins the no-stage lane, at the end unless dropped inside it", () => {
    const fromTodo = laneDrop({ key: "t", to: "prog", index: 0 }, ["t", "c", "a", "d", "b"], "todo", "manual", column)
    expect(fromTodo).toMatchObject({ statusId: "prog", before: null, after: null })
    expect(fromTodo!.position > "a3").toBe(true)
    expect(laneDrop({ key: "t", to: "prog", index: 3 }, ["c", "a", "d", "t", "b"], "todo", "manual", column)).toMatchObject({
      statusId: "prog", before: null, after: "b",
    })
  })

  describe("with a Working lane (CEL-105)", () => {
    // building [c], Working [w1, w2], no stage [b]: the lane keys laneOf gives them.
    const working = [card("b", "a1", null), card("c", "a2", "building"), card("w1", "a3", WORKING_LANE), card("w2", "a5", WORKING_LANE)]

    it("a Working card dropped among the no-stage lane snaps back, and so does a no-stage card dropped among Working", () => {
      expect(laneDrop({ key: "w1", to: "prog", index: 3 }, ["c", "w2", "b", "w1"], "prog", "manual", working)).toBeNull()
      expect(laneDrop({ key: "b", to: "prog", index: 1 }, ["c", "b", "w1", "w2"], "prog", "manual", working)).toBeNull()
    })

    it("a Working card dropped between Working neighbours goes between them", () => {
      expect(laneDrop({ key: "w2", to: "prog", index: 1 }, ["c", "w2", "w1", "b"], "prog", "manual", working)).toMatchObject({
        statusId: "prog", before: null, after: "w1",
      })
      expect(laneDrop({ key: "w1", to: "prog", index: 2 }, ["c", "w2", "w1", "b"], "prog", "manual", working)).toMatchObject({
        statusId: "prog", before: "w2", after: null,
      })
    })

    it("a card from another column joins the no-stage lane: dropped among Working it goes to the end, dropped by a no-stage card it goes next to it", () => {
      const amongWorking = laneDrop({ key: "t", to: "prog", index: 2 }, ["c", "w1", "t", "w2", "b"], "todo", "manual", working)
      expect(amongWorking).toMatchObject({ statusId: "prog", before: null, after: null })
      expect(amongWorking!.position > "a5").toBe(true)
      expect(laneDrop({ key: "t", to: "prog", index: 3 }, ["c", "w1", "w2", "t", "b"], "todo", "manual", working)).toMatchObject({
        statusId: "prog", before: null, after: "b",
      })
    })
  })

  it("with a filter hiding some of the lane, the card goes next to its shown neighbor among the whole lane (CEL-52)", () => {
    // review lane: a, d (hidden by the filter), e.
    const withHidden = [...column, card("e", "a4", "review")]
    expect(laneDrop({ key: "e", to: "prog", index: 1 }, ["c", "e", "a", "b"], "prog", "manual", withHidden)).toMatchObject({ before: null, after: "a" })
    expect(laneDrop({ key: "a", to: "prog", index: 2 }, ["c", "e", "a", "b"], "prog", "manual", withHidden)).toMatchObject({ before: "e", after: null })
  })
})
