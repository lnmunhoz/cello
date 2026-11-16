// Cello's background service on macOS (CEL-81): a launchd user agent that runs `cello start` from login
// and restarts it if it dies. `cello service install` writes the plist; the desktop app reads it to tell
// whether the server it joins is the service. Pure: the paths, the plist's text, and reading it back.
//
// launchd starts a job with an almost empty environment and never reads the user's shell profile, so
// the plist spells out PATH (the server runs git and ffmpeg), HOME and Cello's own variables.

export const SERVICE_LABEL = "dev.cello.server"
export const PLIST_FILE = `${SERVICE_LABEL}.plist`

/** ~/Library/LaunchAgents/dev.cello.server.plist */
export const plistPath = (home: string): string => `${home}/Library/LaunchAgents/${PLIST_FILE}`

/** The service's stdout and stderr: <dataDir>/logs/server.log. */
export const serviceLogPath = (dataDir: string): string => `${dataDir}/logs/server.log`

export interface ServiceSpec {
  /** The absolute command launchd runs: the `cello` binary, then `start`. */
  readonly program: ReadonlyArray<string>
  readonly home: string
  /** PATH for the server (servicePathVariable). */
  readonly path: string
  readonly dataDir: string
  readonly port: number
  readonly logPath: string
}

/** What an installed plist says; null fields when it doesn't say them. */
export interface InstalledService {
  readonly label: string | null
  readonly program: ReadonlyArray<string>
  readonly dataDir: string | null
  readonly port: number | null
  readonly logPath: string | null
}

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
const unescapeXml = (text: string) => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

/**
 * The launch agent: started at login (RunAtLoad) and whenever it exits (KeepAlive), at most once every
 * 5 s (ThrottleInterval), scheduled like an app rather than a background job (ProcessType Interactive).
 */
export const renderPlist = (spec: ServiceSpec): string => {
  const string = (value: string) => `<string>${escapeXml(value)}</string>`
  const env: ReadonlyArray<readonly [string, string]> = [
    ["PATH", spec.path],
    ["HOME", spec.home],
    ["CELLO_DATA_DIR", spec.dataDir],
    ["CELLO_PORT", String(spec.port)],
  ]
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  ${string(SERVICE_LABEL)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...spec.program.map((argument) => `    ${string(argument)}`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...env.flatMap(([key, value]) => [`    <key>${key}</key>`, `    ${string(value)}`]),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  ${string(spec.home)}`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>5</integer>`,
    `  <key>ProcessType</key>`,
    `  <string>Interactive</string>`,
    `  <key>StandardOutPath</key>`,
    `  ${string(spec.logPath)}`,
    `  <key>StandardErrorPath</key>`,
    `  ${string(spec.logPath)}`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n")
}

const stringAfterKey = (xml: string, key: string): string | null => {
  const found = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)
  return found ? unescapeXml(found[1]!) : null
}

/** Reads a plist renderPlist wrote (or one like it); null when it names no program. */
export const parsePlist = (xml: string): InstalledService | null => {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1]
  const program = array ? [...array.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unescapeXml(m[1]!)) : []
  if (program.length === 0) return null
  const port = stringAfterKey(xml, "CELLO_PORT")
  return {
    label: stringAfterKey(xml, "Label"),
    program,
    dataDir: stringAfterKey(xml, "CELLO_DATA_DIR"),
    port: port !== null && /^\d+$/.test(port) ? Number(port) : null,
    logPath: stringAfterKey(xml, "StandardOutPath"),
  }
}

const USUAL_FOLDERS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]

/**
 * The service's PATH: the program's own folder, then the installer's PATH (where git, ffmpeg and bun
 * were found), then the usual system folders; each once, without entries a plist can't hold.
 */
export const servicePathVariable = (program: string, installerPath: string): string => {
  const folder = program.slice(0, Math.max(program.lastIndexOf("/"), 1))
  const usable = (dir: string) => dir.length > 0 && !/[\u0000-\u001f]/.test(dir)
  return [...new Set([folder, ...installerPath.split(":"), ...USUAL_FOLDERS].filter(usable))].join(":")
}
