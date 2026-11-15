// Where the desktop e2e tests may run. They launch Electron, which opens real windows, so on a Mac
// they would take over Lucas's screen while he works. They run in the Docker container instead
// (`bun run test:docker:desktop`), under a virtual screen. apps/desktop/playwright.config.ts asks.

/** Set by scripts/test-in-docker.ts inside the container. */
export const IN_CONTAINER = { name: "CELLO_DESKTOP_E2E", value: "docker" } as const
/** The explicit, rare opt-in for a check only macOS can do (Dock, LaunchServices, the app menu). */
export const ALLOW_LOCAL = { name: "CELLO_ALLOW_LOCAL_DESKTOP", value: "1" } as const

/**
 * Why the desktop e2e tests may not run here, or null when they may. On macOS only the explicit
 * opt-in lets them run: the container's flag doesn't count there, since Docker runs Linux and a
 * Mac that has it was given it by hand.
 */
export const desktopE2eRefusal = (platform: string, env: Readonly<Record<string, string | undefined>>): string | null => {
  if (platform !== "darwin" || env[ALLOW_LOCAL.name] === ALLOW_LOCAL.value) return null
  return [
    "The desktop e2e tests open real Electron windows, so they don't run on this Mac.",
    "Run them in Docker instead: `bun run test:docker:desktop` (from the repo root, `-- <playwright args>` to pick tests).",
    "Videos and screenshots land in test-results/docker/latest/desktop/.",
    `Only for a check that needs macOS itself (Dock, cello:// through LaunchServices, the app menu), and only when asked: ${ALLOW_LOCAL.name}=${ALLOW_LOCAL.value}.`,
  ].join("\n")
}
