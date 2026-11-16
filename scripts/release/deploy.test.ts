// The release's last step: back up the live board, put the staged build live, restart the background service.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { deploy, installStaged, liveBinaryProblem } from "./deploy.ts"

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-deploy-")))
afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

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

describe("installStaged", () => {
  it("renames the staged build over the live one in one step, so the live file is never half written", () => {
    const dir = path.join(base, "install")
    fs.mkdirSync(path.join(dir, "release/stage"), { recursive: true })
    fs.mkdirSync(path.join(dir, "apps/cli/dist"), { recursive: true })
    const staged = path.join(dir, "release/stage/cello")
    const live = path.join(dir, "apps/cli/dist/cello")
    fs.writeFileSync(live, "old build")
    fs.writeFileSync(staged, "new build", { mode: 0o755 })
    const stagedInode = fs.statSync(staged).ino
    installStaged(staged, live)
    expect(fs.readFileSync(live, "utf8")).toBe("new build")
    expect(fs.statSync(live).mode & 0o111).not.toBe(0)
    expect(fs.statSync(live).ino).toBe(stagedInode) // the staged file itself, renamed: never rewritten in place
    expect(fs.existsSync(staged)).toBe(false)
  })

  it("refuses when there's no staged build", () => {
    expect(() => installStaged(path.join(base, "nope/cello"), path.join(base, "live"))).toThrow(
      /No staged build at .*nope\/cello: the release's build didn't run or was moved/,
    )
  })
})

describe("deploy", () => {
  const plan = { live: "/b/cello", built: "/b/cello", staged: "/s/cello" }
  const recorder = (fail: (step: string) => number = () => 0) => {
    const ran: string[] = []
    return {
      ran,
      run: (cmd: ReadonlyArray<string>) => {
        ran.push(cmd.join(" "))
        return fail(cmd.join(" "))
      },
      install: (staged: string, live: string) => {
        ran.push(`install ${staged} -> ${live}`)
      },
    }
  }

  it("backs up with the old cello first, then puts the staged build live, then restarts the service", () => {
    const r = recorder()
    deploy(plan, r.run, r.install)
    expect(r.ran).toEqual(["cello backup", "install /s/cello -> /b/cello", "cello service restart"])
  })

  it("never puts the build live or restarts without a backup", () => {
    const r = recorder(() => 1)
    expect(() => deploy(plan, r.run, r.install)).toThrow(
      /cello backup failed \(exit 1\): the live cello and server weren't touched\. Deploy again once it works: bun scripts\/release\/deploy\.ts/,
    )
    expect(r.ran).toEqual(["cello backup"])
  })

  it("says a failed restart leaves the release out and where to look", () => {
    const r = recorder((step) => (step.includes("restart") ? 1 : 0))
    expect(() => deploy(plan, r.run, r.install)).toThrow(
      /cello service restart failed \(exit 1\)\. The release is out and its cello is in place; the live server isn't on it yet: cello service status says why/,
    )
  })

  it("touches nothing when the live binary isn't this build", () => {
    const r = recorder()
    expect(() => deploy({ ...plan, live: "/x/cello" }, r.run, r.install)).toThrow(/isn't this checkout's build/)
    expect(r.ran).toEqual([])
  })
})
