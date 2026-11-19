// Who this desktop app is to macOS, for each flavor (packages/release/src/flavor.ts, CEL-149). The release
// (what GitHub Actions builds, what people download) is Cello; the build Lucas makes on his Mac from the repo
// is Cello Dev, a separate app with its own name, bundle id, link scheme, icon and state, so both can be
// installed and run side by side. Cello Dev doesn't check GitHub for updates: `bun run release` and
// `bun run package -- --install` update it.
//
// The flavor is set when the app is built: scripts/build.ts bakes it into main.cjs, and the package script
// gives electron-builder the matching name, id, scheme and icon (src/install/builderConfig.ts).
import * as path from "node:path"
import { celloScheme } from "@cello/release/celloLink"
import type { Flavor } from "@cello/release/flavor"

export interface AppIdentity {
  readonly flavor: Flavor
  /** The app's name: the menu, the window, Info.plist's CFBundleName, the `.app` and its executable. */
  readonly name: string
  /** The bundle id (CFBundleIdentifier). */
  readonly appId: string
  /** The link scheme it claims (CFBundleURLSchemes): `cello`, or `cello-dev`. */
  readonly scheme: string
  /** Where `bun run package -- --install` puts it, and where its Restart looks. */
  readonly installedApp: string
  /** The Icon Composer document electron-builder compiles into its icon, under apps/desktop. */
  readonly icon: string
  /** The packaged app checks GitHub's releases for updates (CEL-140). */
  readonly checksUpdates: boolean
}

const NAMES: Readonly<Record<Flavor, { name: string; appId: string; icon: string }>> = {
  release: { name: "Cello", appId: "app.cello.desktop", icon: "resources/Cello.icon" },
  dev: { name: "Cello Dev", appId: "app.cello.desktop.dev", icon: "resources/CelloDev.icon" },
}

export const appIdentity = (flavor: Flavor): AppIdentity => {
  const { name, appId, icon } = NAMES[flavor]
  return { flavor, name, appId, scheme: celloScheme(flavor), installedApp: `/Applications/${name}.app`, icon, checksUpdates: flavor === "release" }
}

/** Every flavor's app bundle name, `Cello.app` and `Cello Dev.app`: what a build folder may hold. */
export const APP_BUNDLES: ReadonlyArray<string> = (Object.keys(NAMES) as Flavor[]).map((flavor) => `${NAMES[flavor].name}.app`)

/** An app bundle's main executable: electron-builder names it after the app. */
export const executableOf = (bundle: string, identity: AppIdentity): string => path.join(bundle, "Contents/MacOS", identity.name)

/**
 * The folder in ~/Library/Application Support the app keeps its state in (window, quit choice, updates,
 * board). Packaged, the app's name; run from the repo (`bun run dev`), a folder of its own, so a dev run
 * and the installed app never share a single-instance lock or a window state.
 */
export const userDataName = (identity: AppIdentity, isPackaged: boolean): string =>
  isPackaged ? identity.name : `${identity.name} (unpackaged)`
