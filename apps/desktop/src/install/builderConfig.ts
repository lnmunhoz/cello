// The electron-builder config one `bun run package` uses: electron-builder.json, adjusted for
//   - `--cli <binary>`: Cello.app's Contents/Resources/cello taken from <binary> instead of apps/cli/dist/cello.
//     A release (CEL-36) bundles its staged build this way, so packaging never needs the live binary replaced.
//   - `--arch arm64|x64`: which Mac it's for (CEL-139). electron-builder uses this machine's Electron
//     (electronDist), so each architecture is packaged on a Mac of its own kind (the release workflow's runners).
//   - `--artifacts`: also the DMG and zip a release attaches (Cello-v<version>-mac-<arch>.dmg and .zip in dist/).
//   - `--sign`: signed with the Developer ID certificate in CSC_LINK, with the hardened runtime, and notarized
//     when APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are set. Without it, signed ad hoc
//     (electron-builder.json's identity "-"): no developer named, but the whole bundle, helpers and
//     Resources/cello included, is sealed again after electron-builder rewrote it, so a downloaded copy gets
//     macOS's "can't verify the developer" prompt (Open Anyway) instead of "is damaged". electron-builder
//     only falls back to ad hoc after finding no keychain identity whose name contains "-".

//   - `--flavor release|dev` (CEL-149): which app it is. electron-builder.json is the release, Cello; dev is Cello Dev,
//     with its own name, bundle id, `cello-dev://` scheme and DEV icon (src/flavor.ts). A package made on the Mac
//     is dev unless it says otherwise; `--artifacts` (the downloads) is the release.
import { flavorArg, type Flavor } from "@cello/shared/flavor"
import { appIdentity } from "../flavor.ts"

type Resource = { readonly from: string; readonly to: string }
type BuilderConfig = { readonly extraResources?: ReadonlyArray<Resource>; readonly mac?: Record<string, unknown> } & Record<string, unknown>

export type Arch = "arm64" | "x64"
export type Packaging = { readonly arch: Arch; readonly artifacts: boolean; readonly sign: boolean; readonly flavor: Flavor }

export const bundlingCli = <C extends BuilderConfig>(config: C, binary: string): C => {
  const resources = config.extraResources ?? []
  if (!resources.some((r) => r.to === "cello")) throw new Error("electron-builder.json has no extraResources entry for cello.")
  return { ...config, extraResources: resources.map((r) => (r.to === "cello" ? { ...r, from: binary } : r)) }
}

const ENTITLEMENTS = "resources/entitlements.mac.plist"

export const packagingConfig = <C extends BuilderConfig>(config: C, packaging: Packaging): C => {
  const targets = packaging.artifacts ? ["dmg", "zip"] : ["dir"]
  // Signed: no identity at all, so electron-builder takes the certificate CSC_LINK imports.
  const { identity: _adHoc, ...developerId } = config.mac ?? {}
  const signing = packaging.sign
    ? { ...developerId, hardenedRuntime: true, entitlements: ENTITLEMENTS, entitlementsInherit: ENTITLEMENTS }
    : { ...config.mac }
  const mac = { ...signing, target: targets.map((target) => ({ target, arch: [packaging.arch] })) }
  if (packaging.flavor === "release") return { ...config, mac }
  const dev = appIdentity("dev")
  return {
    ...config,
    productName: dev.name,
    appId: dev.appId,
    protocols: [{ name: dev.name, schemes: [dev.scheme] }],
    mac: { ...mac, icon: dev.icon, artifactName: `${dev.name.replaceAll(" ", "-")}-v\${version}-mac-\${arch}.\${ext}` },
  }
}

/** Where electron-builder puts the app, under apps/desktop: it leaves its default arch (x64) out of the folder's name. */
export const packagedApp = (arch: Arch, flavor: Flavor): string =>
  `dist/${arch === "x64" ? "mac" : "mac-arm64"}/${appIdentity(flavor).name}.app`

/** package.ts's --arch, --artifacts, --sign and --flavor; its other flags are its own. */
export const parsePackaging = (argv: ReadonlyArray<string>): Packaging => {
  const flag = argv.indexOf("--arch")
  const arch = flag === -1 ? "arm64" : argv[flag + 1]
  if (arch !== "arm64" && arch !== "x64") throw new Error(`--arch takes arm64 or x64, not ${arch ?? "nothing"}.`)
  const artifacts = argv.includes("--artifacts")
  return { arch, artifacts, sign: argv.includes("--sign"), flavor: flavorArg(argv, artifacts ? "release" : "dev") }
}
