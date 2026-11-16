// The electron-builder config `bun run package -- --cli <binary>` packages with: electron-builder.json, but
// with Cello.app's Contents/Resources/cello taken from <binary> instead of apps/cli/dist/cello. A release
// (CEL-36) bundles its staged build this way, so packaging never needs the live binary replaced.

type Resource = { readonly from: string; readonly to: string }
type BuilderConfig = { readonly extraResources?: ReadonlyArray<Resource> } & Record<string, unknown>

export const bundlingCli = <C extends BuilderConfig>(config: C, binary: string): C => {
  const resources = config.extraResources ?? []
  if (!resources.some((r) => r.to === "cello")) throw new Error("electron-builder.json has no extraResources entry for cello.")
  return { ...config, extraResources: resources.map((r) => (r.to === "cello" ? { ...r, from: binary } : r)) }
}
