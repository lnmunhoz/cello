// Errors say what to do next, from one table keyed by error tag.
import { HumanOnly, NotFound, ReviewRequired, TaskClaimed } from "@cello/contract/errors"
import { describe, expect, it } from "vitest"
import { explain } from "./errors.ts"

const now = 1_800_000_000_000
const where = { port: 4747, now }

describe("explain", () => {
  it("a claimed task names the holder, how recently it was active, and what to do", () => {
    expect(explain(new TaskClaimed({ key: "CEL-3", holder: "Claude Code", sessionId: "9f2c1a7b-aaaa", lastSeenAt: now - 5_000 }), where)).toBe(
      "CEL-3 is claimed by Claude Code session 9f2c1a7b (active now). Pick another task or run `cello task get CEL-3`.",
    )
    expect(explain(new TaskClaimed({ key: "CEL-3", holder: "Codex", sessionId: "s1", lastSeenAt: now - 3 * 60_000 }), where)).toContain(
      "Codex session s1 (active 3m ago)",
    )
    expect(explain(new TaskClaimed({ key: "CEL-3", holder: "Lucas", sessionId: null, lastSeenAt: null }), where)).toBe(
      "CEL-3 is claimed by Lucas. Pick another task or run `cello task get CEL-3`.",
    )
  })

  it("an unknown folder points at --project", () => {
    expect(explain(new NotFound({ entity: "project", id: "/tmp/elsewhere" }), where)).toBe(
      "No project is linked to /tmp/elsewhere. Pass --project KEY (`cello init` comes later in M2).",
    )
    expect(explain(new NotFound({ entity: "task", id: "CEL-99" }), where)).toBe("No task CEL-99. Run `cello task list` to see open tasks.")
  })

  it("moving to In Review without a packet points at `cello task submit`", () => {
    expect(explain(new ReviewRequired({ key: "CEL-7", status: "In Review" }), where)).toBe(
      "CEL-7 needs a review packet before it goes to In Review. Submit one instead: " +
        "`cello task submit CEL-7 --summary \"what changed\" --step \"how to check it\" --attach demo.mp4`. See `cello guide`.",
    )
  })

  it("only the human decides reviews", () => {
    expect(explain(new HumanOnly({ action: "approve a review", human: "Lucas" }), where)).toBe(
      "Only Lucas can approve a review. Leave the task in In Review; Lucas decides on the Review page.",
    )
  })

  it("an unreachable server says how to start it", () => {
    expect(explain({ _tag: "RpcClientError", reason: { _tag: "SocketOpenError" } }, where)).toBe(
      "Cello isn't running on 127.0.0.1:4747. Start it with `cello start`.",
    )
  })
})
