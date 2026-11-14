import { HumanOnly, Invalid, KeyTaken, NotFound, ReviewRequired, VersionConflict } from "@cello/contract/errors"
import { describe, expect, it } from "vitest"
import { describeError } from "./describeError.ts"

describe("describeError", () => {
  it("names who changed a task since you opened it", () => {
    const error = new VersionConflict({ entity: "task", id: "t1", currentVersion: 4, changedBy: "Claude" })
    expect(describeError(error)).toBe("Changed by Claude since you opened it")
    expect(describeError(error, { subject: "THAI-12" })).toBe("THAI-12 was changed by Claude since you opened it")
  })

  it("explains the other API errors", () => {
    expect(describeError(new KeyTaken({ key: "THAI", projectName: "ThaiLookup" }))).toBe("THAI is used by ThaiLookup")
    expect(describeError(new NotFound({ entity: "task", id: "t1" }))).toBe("That task no longer exists")
    expect(describeError(new Invalid({ field: "title", reason: "Title can't be empty" }))).toBe("Title can't be empty")
    expect(describeError(new HumanOnly({ action: "approve a review", human: "Lucas" }))).toBe("Only Lucas can approve a review")
    expect(describeError(new ReviewRequired({ key: "CEL-7", status: "In Review" }))).toBe("CEL-7 needs a review packet before In Review")
  })

  it("reports a lost connection and anything else plainly", () => {
    expect(describeError({ _tag: "RpcClientError", message: "socket" })).toBe("Can't reach the Cello server")
    expect(describeError(new Error("boom"))).toBe("Something went wrong: boom")
  })
})
