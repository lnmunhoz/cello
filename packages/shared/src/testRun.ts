// An agent running tests (CEL-134): which shell commands run tests, what a run is called on the board,
// and a run in words ("web e2e 7 of 13 · 1 failed · 3m12s"). The hook decides with isTestCommand when a
// tool call starts a run; the board, the task panel and `cello agents` show it with these words.

/**
 * Shell words, one list per command: split at `&&`, `||`, `;` and `|` and at spaces, except inside single
 * or double quotes, which are taken off (`git commit -m "fix; bun run test"` is one command of four
 * words). Enough to read a command line, not a shell: no escapes, `$(…)` or redirections.
 */
export const commandWords = (line: string): string[][] => {
  const commands: string[][] = [[]]
  let word: string | null = null
  let quote: string | null = null
  const endWord = () => {
    if (word !== null) commands.at(-1)!.push(word)
    word = null
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote !== null) {
      if (c === quote) quote = null
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      word ??= ""
    } else if (c === "&" && (line[i - 1] === ">" || line[i + 1] === ">")) {
      // A redirection (`2>&1`, `&>`), not a separator.
      word = (word ?? "") + c
    } else if (c === ";" || c === "|" || c === "&") {
      endWord()
      // `&&` and `||` are one separator; a lone `&` (background) ends the command too.
      if ((c === "|" || c === "&") && line[i + 1] === c) i++
      commands.push([])
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word = (word ?? "") + c
    }
  }
  endWord()
  return commands.filter((words) => words.length > 0)
}

/** One command's words without the `VAR=value` assignments before its program. */
const program = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const first = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  return first === -1 ? [] : words.slice(first)
}

const base = (word: string | undefined) => word?.split("/").at(-1) ?? ""

/** A package script that runs tests: `test`, `test:e2e`, `test:docker:desktop`, `test:unit`, … */
const testScript = (word: string | undefined) => word !== undefined && /^test(:[\w:-]+)?$/.test(word)

/** Whether one command (its words, assignments dropped) runs tests. */
const runsTests = (words: ReadonlyArray<string>): boolean => {
  const [cmd, sub, ...rest] = words
  const name = base(cmd)
  if (words.some((word) => word.endsWith("test-in-docker.ts"))) return true
  if (name === "bun" || name === "npm" || name === "pnpm" || name === "yarn") {
    if (sub === "test") return true
    if (sub === "run" && testScript(rest[0])) return true
    if (name === "yarn" && testScript(sub)) return true
    // `bun --bun vitest run`, `bun x vitest`
    return words.slice(1).some((word) => base(word) === "vitest") || (words.includes("playwright") && words.includes("test"))
  }
  if (name === "npx" || name === "bunx" || name === "pnpx") return runsTests(words.slice(1))
  if (name === "vitest" || name === "jest" || name === "pytest") return true
  if (name === "playwright") return sub === "test"
  if (name === "cargo" || name === "go") return sub === "test"
  return false
}

/**
 * Whether a shell command runs tests (CEL-134): Cello's own (`bun run test`, `bun run test:e2e`,
 * `test:docker*`, `scripts/test-in-docker.ts`, which are also its testing profile's commands) and the
 * usual runners elsewhere (vitest, jest, playwright test, pytest, `npm test`, `cargo test`, `go test`).
 * A command that only mentions one (`echo`, `grep`, `git commit -m`) doesn't.
 */
export const isTestCommand = (command: string): boolean => commandWords(command).some((words) => runsTests(program(words)))

/** The first command in the line that runs tests, as words. */
const testWords = (command: string): ReadonlyArray<string> =>
  commandWords(command).map(program).find(runsTests) ?? []

/** What a run is called on the board: "web e2e", "desktop e2e", "Docker tests", "unit tests", "e2e", else "tests". */
export const testRunLabel = (command: string): string => {
  const words = testWords(command)
  const docker = words.findIndex((word) => word.endsWith("test-in-docker.ts"))
  const mode = docker === -1 ? null : words[docker + 1]
  // The package script: after `run` (`bun run test:e2e`), or yarn's own (`yarn test:e2e`).
  const run = words.indexOf("run")
  const script = [run === -1 ? undefined : words[run + 1], base(words[0]) === "yarn" ? words[1] : undefined].find(testScript)
  if (mode === "e2e" || script === "test:e2e" || script === "test:e2e:local" || script === "test:docker:e2e") return "web e2e"
  if (mode === "desktop" || script === "test:docker:desktop") return "desktop e2e"
  if (mode === "all" || script === "test:docker") return "Docker tests"
  if (script === "test" || words.some((word) => base(word) === "vitest")) return "unit tests"
  if (words.includes("playwright")) return "e2e"
  return "tests"
}

/**
 * The files and folders the first test command in a line named (CEL-181): `bun run test:e2e -- e2e/a.spec.ts`
 * gives `["e2e/a.spec.ts"]`, a bare `bun run test` none. A target is a word with a `/` or a file extension
 * that isn't a flag, a `VAR=x`, the Docker runner's own script, or a quoted phrase (`-t "a name"`).
 */
export const testRunTargets = (command: string): ReadonlyArray<string> =>
  testWords(command)
    .slice(1)
    .filter((word) => !word.startsWith("-") && !/\s/.test(word) && !word.endsWith("test-in-docker.ts") && (word.includes("/") || /\.\w+$/.test(word)))

/** The one id of a run, shared by its live row and its finished line (CEL-181): `tests:<session>:<agent or ->:<startedAt>`. */
export const testRunKey = (sessionId: string, agentId: string | null, startedAt: number): string => `tests:${sessionId}:${agentId ?? "-"}:${startedAt}`

/** The Docker runner's modes (`scripts/test-in-docker.ts <mode>`). */
export type DockerMode = "all" | "e2e" | "desktop"

/**
 * The stages scripts/test-in-docker.ts runs in each mode, in order; its reports name the one it's on
 * (`stage`). `install` comes first and stops the run when it fails.
 */
export const DOCKER_STEPS: Readonly<Record<DockerMode, ReadonlyArray<string>>> = {
  all: ["install", "unit", "typecheck", "web-e2e", "desktop-e2e"],
  e2e: ["install", "web-e2e"],
  desktop: ["install", "desktop-e2e"],
}

/** What the board calls a run of each Docker mode (testRunLabel). */
export const DOCKER_LABELS: Readonly<Record<DockerMode, string>> = { all: "Docker tests", e2e: "web e2e", desktop: "desktop e2e" }

/**
 * Whether a runner reporting `stage` could be running the run the board calls `label` (CEL-147): the
 * Docker mode of that name runs that stage. `web-e2e` fits "web e2e" and "Docker tests", `install` every
 * Docker run; no stage, or one Cello doesn't know, fits none in particular.
 */
export const stageFits = (stage: string | null, label: string): boolean =>
  stage !== null && (Object.keys(DOCKER_LABELS) as DockerMode[]).some((mode) => DOCKER_LABELS[mode] === label && DOCKER_STEPS[mode].includes(stage))

/** How long, short: "42s", "3m12s", "1h05m". */
export const elapsedWords = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`
}

/** What the words need of a run's progress (the contract's TestProgress). */
export interface TestProgressLike {
  readonly passed: number
  readonly failed: number
  readonly total: number | null
}

/** What the words need of a run (the contract's TestRun). */
export interface TestRunLike {
  readonly label: string
  /** The command in one line; only `testRunWords`'s `targets` option reads it. */
  readonly command?: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outcome: "passed" | "failed" | "ended" | null
  readonly progress: TestProgressLike | null
}

/**
 * After this long a run that never heard its end (a hook that didn't fire, a machine that slept) is
 * no longer shown as running: no test run of Cello's takes half as long.
 */
export const STALE_RUN_MS = 3 * 60 * 60 * 1000

/** Whether a run is running now: not ended, and not started so long ago that its end was surely missed. */
export const isRunning = (run: TestRunLike | null | undefined, now: number): boolean =>
  run != null && run.endedAt === null && now - run.startedAt < STALE_RUN_MS

/** Tests done so far: passed and failed. */
const doneOf = (p: TestProgressLike) => p.passed + p.failed

/**
 * A run in words. Running: "web e2e 7 of 13 · 1 failed · 3m12s" (no total yet: "7 done"; no progress:
 * "web e2e · 1m20s"). Finished: "web e2e passed · 13 of 13 · 4m02s", "web e2e failed · 1 failed of 13 · 1m00s".
 * `targets` (CEL-181) names up to two of the files the command ran after the label, "+N more" for the rest:
 * "web e2e · e2e/pages.spec.ts · 7 of 13 · 1 failed · 3m12s", "web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s".
 */
export const testRunWords = (
  run: TestRunLike,
  now: number,
  options: { readonly failed?: boolean; readonly targets?: boolean } = {},
): string => {
  const p = run.progress
  const time = elapsedWords((run.endedAt ?? now) - run.startedAt)
  const found = options.targets === true && run.command !== undefined ? testRunTargets(run.command) : []
  const named = found.length === 0 ? null : found.length > 2 ? `${found.slice(0, 2).join(", ")} +${found.length - 2} more` : found.join(", ")
  if (run.endedAt !== null) {
    const counts = p === null ? null : p.failed > 0 ? `${p.failed} failed of ${p.total ?? doneOf(p)}` : `${doneOf(p)} of ${p.total ?? doneOf(p)}`
    return [`${run.label} ${run.outcome ?? "ended"}`, named, counts, time].filter((part) => part !== null).join(" · ")
  }
  if (p === null) return [run.label, named, time].filter((part) => part !== null).join(" · ")
  const where = p.total === null ? `${doneOf(p)} done` : `${doneOf(p)} of ${p.total}`
  // `failed: false` leaves a running run's failures out, for a screen that shows them on their own.
  const failed = p.failed > 0 && options.failed !== false ? `${p.failed} failed` : null
  return [named === null ? `${run.label} ${where}` : run.label, named, named === null ? null : where, failed, time].filter((part) => part !== null).join(" · ")
}

/** A run short, for a card's stage line: "web e2e 7/13", "web e2e 7 done", "web e2e". */
export const testRunShort = (run: TestRunLike): string => {
  const p = run.progress
  if (p === null) return run.label
  return p.total === null ? `${run.label} ${doneOf(p)} done` : `${run.label} ${doneOf(p)}/${p.total}`
}
