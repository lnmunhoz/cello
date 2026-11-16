// The release's last step: back up the live board, then restart the background service on the new build.
import { describe, expect, it } from "vitest"
import { DEPLOY_STEPS, deploy, liveBinaryProblem } from "./deploy.ts"

describe("liveBinaryProblem", () => {
  const built = "/Users/l/projects/cello/apps/cli/dist/cello"

  it("is fine when the cello on PATH is this checkout's build (through the ~/.local/bin symlink)", () => {
    expect(liveBinaryProblem({ live: built, built })).toBeNull()
  })

  it("refuses when it isn't: the restart would run another build", () => {
    expect(liveBinaryProblem({ live: "/opt/cello/cello", built })).toBe(
      `The cello on your PATH (/opt/cello/cello) isn't this checkout's build (${built}), so a restart wouldn't run the release. Deploy by hand: cello backup, then cello service restart with the cello you want the service to run.`,
    )
    expect(liveBinaryProblem({ live: null, built })).toMatch(/No cello on your PATH/)
  })
})

describe("deploy", () => {
  const ok = { live: "/b/cello", built: "/b/cello" }

  it("backs up, then restarts the service", () => {
    const ran: string[] = []
    deploy(ok, (cmd) => {
      ran.push(cmd.join(" "))
      return 0
    })
    expect(DEPLOY_STEPS.map((s) => s.join(" "))).toEqual(["cello backup", "cello service restart"])
    expect(ran).toEqual(["cello backup", "cello service restart"])
  })

  it("never restarts without a backup", () => {
    const ran: string[] = []
    expect(() =>
      deploy(ok, (cmd) => {
        ran.push(cmd.join(" "))
        return 1
      }),
    ).toThrow(/cello backup failed \(exit 1\): the live server wasn't restarted/)
    expect(ran).toEqual(["cello backup"])
  })

  it("says a failed restart leaves the release out and where to look", () => {
    expect(() => deploy(ok, (cmd) => (cmd.includes("restart") ? 1 : 0))).toThrow(
      /cello service restart failed \(exit 1\)\. The release is out; the live server isn't on it yet: cello service status says why/,
    )
  })

  it("runs nothing when the live binary isn't this build", () => {
    const ran: string[] = []
    expect(() =>
      deploy({ live: "/x/cello", built: "/b/cello" }, (cmd) => {
        ran.push(cmd.join(" "))
        return 0
      }),
    ).toThrow(/isn't this checkout's build/)
    expect(ran).toEqual([])
  })
})
