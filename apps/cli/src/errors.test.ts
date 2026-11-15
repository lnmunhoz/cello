// Errors say what to do next, from one table keyed by error tag.
import { HumanOnly, NotFound, ReviewRequired, TaskClaimed } from "@cello/contract/errors"
import { BackupFailed, RestoreBlocked, RestoreFailed } from "@cello/server/backup/offline"
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

  it("a missing document or version points at `cello doc list`", () => {
    expect(explain(new NotFound({ entity: "document", id: "CEL/billing-audit" }), where)).toBe(
      "No document CEL/billing-audit. Run `cello doc list` to see the project's documents.",
    )
    expect(explain(new NotFound({ entity: "document version", id: "CEL/billing-audit@4" }), where)).toBe(
      "No version 4 of CEL/billing-audit. Run `cello doc list` to see the project's documents.",
    )
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

  it("a restore refused while Cello runs says nothing changed and how to stop it", () => {
    expect(explain(new RestoreBlocked({ id: "20261115-120000", dataDir: "/data", pid: 42, port: 4747 }), where)).toBe(
      "Cello is running for /data (pid 42, http://127.0.0.1:4747), and restore only runs while it's stopped; nothing was changed. " +
        "Stop it: press Ctrl-C in the terminal running `cello start`, or quit the Cello desktop app (there's no `cello stop` yet). " +
        "Then run `cello restore 20261115-120000` again.",
    )
  })

  it("a failed restore says what failed, whether anything changed, and the safety backup", () => {
    const failure = { id: "20261115-120000", dataDir: "/data", step: "swapping the files in", reason: "EPERM: operation not permitted" }
    expect(explain(new RestoreFailed({ ...failure, unchanged: true, safetyId: "20261115-130000", keptAt: null }), where)).toBe(
      "The restore of 20261115-120000 failed while swapping the files in (EPERM: operation not permitted). " +
        "Nothing was changed: your data is as it was, and safety backup 20261115-130000 holds it too.",
    )
    expect(explain(new RestoreFailed({ ...failure, step: "copying the backup", unchanged: true, safetyId: null, keptAt: null }), where)).toBe(
      "The restore of 20261115-120000 failed while copying the backup (EPERM: operation not permitted). Nothing was changed: your data is as it was.",
    )
  })

  it("a restore that couldn't move the files back says where the data is and how to put it back", () => {
    expect(explain(new RestoreFailed({
      id: "20261115-120000",
      dataDir: "/data",
      step: "swapping the files in",
      reason: "EPERM: operation not permitted",
      unchanged: false,
      safetyId: "20261115-130000",
      keptAt: "/data/.restore-20261115-120000-1",
    }), where)).toBe(
      "The restore of 20261115-120000 failed while swapping the files in (EPERM: operation not permitted), and moving your files back failed too. " +
        "Don't start Cello yet: your data is in /data/.restore-20261115-120000-1/previous. Move everything in it back into /data, " +
        "replacing what's there, or run `cello restore 20261115-130000` (the safety backup taken just before).",
    )
  })

  it("a failed backup says why, that nothing was saved, and what to check", () => {
    expect(explain(new BackupFailed({ dataDir: "/data", reason: "ENOSPC: no space left on device, write" }), where)).toBe(
      "The backup failed (ENOSPC: no space left on device, write). Nothing was saved, and your data and earlier backups are untouched. " +
        "Check that the disk has room, that every file in /data/assets can be read and that /data/backups can be written, then run `cello backup` again.",
    )
  })

  it("an unreachable server says how to start it", () => {
    expect(explain({ _tag: "RpcClientError", reason: { _tag: "SocketOpenError" } }, where)).toBe(
      "Cello isn't running on 127.0.0.1:4747. Start it with `cello start`.",
    )
  })

  // CEL-17: a server that stops mid-command closes the socket; a write it had started still commits.
  it("a connection cut off mid-command says a change may have gone through, and to check before rerunning", () => {
    for (const reason of ["SocketCloseError", "SocketReadError", "SocketWriteError"]) {
      expect(explain({ _tag: "RpcClientError", reason: { _tag: reason } }, where)).toBe(
        "Cello on 127.0.0.1:4747 closed the connection before answering; it may have stopped or restarted. " +
          "If this command changes something, the change may have gone through: check (for example with `cello task get`) " +
          "before running it again, because a rerun is a new command.",
      )
    }
  })
})
