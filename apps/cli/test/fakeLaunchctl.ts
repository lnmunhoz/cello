// A stand-in for macOS's `launchctl`, for tests of `cello service` (CEL-81): the CLI's integration test
// and the desktop e2e put it on PATH with a temp HOME, so no test reaches the real launchd or writes to
// the real ~/Library/LaunchAgents. It keeps launchd's state as files in `state`:
// - calls.log: each call's arguments, one line per call
// - loaded: present once bootstrapped, gone after bootout
// - pid: the job's process, which bootout and kickstart -k stop (only that pid), as launchd would
// - bootstrap-fails: makes bootstrap fail, as a broken plist would
// - respawn: after `kill` or `kickstart`, a new job process starts (a `sleep`), as KeepAlive would
// The test kills a respawned job by the pid in `pid` when it ends.
import * as fs from "node:fs"
import * as path from "node:path"

export const fakeLaunchctlScript = (state: string, uid: number) => `#!/bin/sh
state=${JSON.stringify(state)}
printf '%s\\n' "$*" >> "$state/calls.log"
stop_job() { if [ -f "$state/pid" ]; then read pid < "$state/pid"; kill "$pid"; /bin/rm -f "$state/pid"; fi; }
respawn() { if [ -f "$state/respawn" ]; then /bin/sleep 300 > /dev/null 2>&1 & echo $! > "$state/pid"; fi; }
case "$1" in
  print)
    [ -f "$state/loaded" ] || { echo 'Could not find service "dev.cello.server" in domain for user gui: ${uid}' >&2; exit 113; }
    if [ -f "$state/pid" ]; then read pid < "$state/pid"; printf 'gui/${uid}/dev.cello.server = {\\n\\tstate = running\\n\\tpid = %s\\n\\tlast exit code = (never exited)\\n}\\n' "$pid"
    else printf 'gui/${uid}/dev.cello.server = {\\n\\tstate = not running\\n\\tlast exit code = 78: EX_CONFIG\\n}\\n'; fi ;;
  bootstrap) [ -f "$state/bootstrap-fails" ] && { echo 'Bootstrap failed: 5: Input/output error' >&2; exit 5; }; : > "$state/loaded" ;;
  bootout) [ -f "$state/loaded" ] || exit 113; stop_job; /bin/rm -f "$state/loaded" ;;
  kickstart) [ -f "$state/loaded" ] || { echo 'Could not find service' >&2; exit 113; }; [ "$2" = "-k" ] && stop_job; [ -f "$state/pid" ] || respawn ;;
  kill) [ -f "$state/loaded" ] || { echo 'Could not find service' >&2; exit 113; }; stop_job; respawn ;;
esac
exit 0
`

/** The job process the fake started or was told about, if any: for a test to kill when it ends. */
export const fakeJobPid = (state: string): number | null => {
  const file = path.join(state, "pid")
  return fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8").trim()) : null
}

/** Writes `launchctl` into `bin` (keeping its state in `state`); returns a reader for the calls it got. */
export const writeFakeLaunchctl = (bin: string, state: string, uid: number) => {
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(path.join(bin, "launchctl"), fakeLaunchctlScript(state, uid), { mode: 0o755 })
  const log = path.join(state, "calls.log")
  return { calls: (): string[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []) }
}
