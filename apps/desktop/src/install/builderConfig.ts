// The electron-builder config one `bun run package` uses: electron-builder.json, adjusted for
//   - `--cli <binary>`: Cello.app's Contents/Resources/cello taken from <binary> instead of apps/cli/dist/cello.
//     A release (CEL-36) bundles its staged build this way, so packaging never needs the live binary replaced.
//   - `--arch arm64|x64`: which Mac it's for (CEL-139). electron-builder uses this machine's Electron
//     (electronDist), so each architecture is packaged on a Mac of its own kind (the release workflow's runners).
//   - `--artifacts`: also the DMG and zip a release attaches (Cello-v<version>-mac-<arch>.dmg and .zip in dist/).
//   - `--sign`: signed with the Developer ID certificate in CSC_LINK, with the hardened runtime, and notarized
//     when APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are set; without it the app is unsigned.

type Resource = { readonly from: string; readonly to: string }
type BuilderConfig = { readonly extraResources?: ReadonlyArray<Resource>; readonly mac?: Record<string, unknown> } & Record<string, unknown>

export type Arch = "arm64" | "x64"
export type Packaging = { readonly arch: Arch; readonly artifacts: boolean; readonly sign: boolean }

export const bundlingCli = <C extends BuilderConfig>(config: C, binary: string): C => {
  const resources = config.extraResources ?? []
  if (!resources.some((r) => r.to === "cello")) throw new Error("electron-builder.json has no extraResources entry for cello.")
  return { ...config, extraResources: resources.map((r) => (r.to === "cello" ? { ...r, from: binary } : r)) }
}

const ENTITLEMENTS = "resources/entitlements.mac.plist"

export const packagingConfig = <C extends BuilderConfig>(config: C, packaging: Packaging): C => {
  const targets = packaging.artifacts ? ["dmg", "zip"] : ["dir"]
  const { identity: _unsigned, ...mac } = config.mac ?? {}
  const signing = packaging.sign
    ? { ...mac, hardenedRuntime: true, entitlements: ENTITLEMENTS, entitlementsInherit: ENTITLEMENTS }
    : { ...mac, identity: config.mac?.identity ?? null }
  return { ...config, mac: { ...signing, target: targets.map((target) => ({ target, arch: [packaging.arch] })) } }
}

/** Where electron-builder puts Cello.app, under apps/desktop: it leaves its default arch (x64) out of the folder's name. */
export const packagedApp = (arch: Arch): string => `dist/${arch === "x64" ? "mac" : "mac-arm64"}/Cello.app`

/** package.ts's --arch, --artifacts and --sign; its other flags are its own. */
export const parsePackaging = (argv: ReadonlyArray<string>): Packaging => {
  const flag = argv.indexOf("--arch")
  const arch = flag === -1 ? "arm64" : argv[flag + 1]
  if (arch !== "arm64" && arch !== "x64") throw new Error(`--arch takes arm64 or x64, not ${arch ?? "nothing"}.`)
  return { arch, artifacts: argv.includes("--artifacts"), sign: argv.includes("--sign") }
}
