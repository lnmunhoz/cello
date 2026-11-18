/**
 * Vitest's options for a test whose point is a real OS process (`cello` as Claude Code or launchd runs
 * it, a pid that outlives a server): starting one costs what the machine's load makes it cost. Measured
 * for CEL-121: 0.3–1 s idle, 4–5.5 s at load average ~110, up to 15 s at ~290 (other agents' test runs
 * and Docker), past Vitest's default 5 s. Anything else cuts its work instead: in-process calls
 * (`hookInProcess`), one server per file, smaller tests.
 */
export const UNDER_LOAD = { timeout: 30_000 }
