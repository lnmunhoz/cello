// Spike (a): print what a `cello` command can see about who is calling it.
import { execSync } from "node:child_process";

const AGENT_VAR = /^(CLAUDE|CLAUDECODE|AI_AGENT|CODEX|T3|CURSOR|GEMINI|OPENCODE|AIDER|TERM_PROGRAM|CELLO)/;
const SECRET = /(TOKEN|KEY|SECRET|PASSWORD)/;

const env = Object.fromEntries(
  Object.entries(process.env)
    .filter(([k]) => AGENT_VAR.test(k))
    .map(([k, v]) => [k, SECRET.test(k) ? "<redacted>" : v])
    .sort(([a], [b]) => a.localeCompare(b)),
);

const sh = (cmd: string) => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};

// Walk up the process tree from this process to launchd.
const tree: Array<{ pid: number; ppid: number; command: string }> = [];
let pid = process.pid;
for (let i = 0; i < 25 && pid > 1; i++) {
  const line = sh(`ps -o pid=,ppid=,comm= -p ${pid}`);
  if (!line) break;
  const [p, pp, ...rest] = line.trim().split(/\s+/);
  tree.push({ pid: Number(p), ppid: Number(pp), command: rest.join(" ") });
  pid = Number(pp);
}

const KNOWN = /(claude|codex|t3|cursor|opencode|gemini)/i;
const firstAgent = tree.find((n, i) => i > 0 && KNOWN.test(n.command.split("/").pop() ?? ""));

console.log(JSON.stringify({
  cwd: process.cwd(),
  gitCommonDir: sh("git rev-parse --path-format=absolute --git-common-dir"),
  gitTopLevel: sh("git rev-parse --show-toplevel"),
  env,
  processTree: tree,
  firstKnownAgentAncestor: firstAgent ?? null,
}, null, 2));
