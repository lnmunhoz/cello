// Which build of Cello this is (CEL-149), a setting made when it's built, never at run time:
//   - release: what GitHub Actions builds, the Cello.app and `cello` people download. `cello://` links,
//     updates from GitHub.
//   - dev: what this Mac builds from the repo (`bun run package`, the `cello` that `bun run release`
//     deploys): Cello Dev.app beside the downloaded Cello.app, with its own `cello-dev://` links.
// The scheme each one uses is celloLink.ts's `celloScheme`; the desktop app's name and bundle id are
// apps/desktop/src/flavor.ts.

export type Flavor = "release" | "dev"
export const FLAVORS: ReadonlyArray<Flavor> = ["release", "dev"]

export const parseFlavor = (value: unknown): Flavor | null => (value === "release" || value === "dev" ? value : null)

/** A build script's `--flavor release|dev`, or `fallback` without it. Any other value throws, so nothing builds the wrong app. */
export const flavorArg = (argv: ReadonlyArray<string>, fallback: Flavor): Flavor => {
  const at = argv.indexOf("--flavor")
  if (at === -1) return fallback
  const value = argv[at + 1]
  const flavor = parseFlavor(value)
  if (flavor === null) throw new Error(`--flavor takes release or dev, not ${value ?? "nothing"}.`)
  return flavor
}
