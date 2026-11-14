// The human actor's name on first start: `git config user.name`, else "Me".
export const gitUserName = (): string => {
  try {
    const result = Bun.spawnSync(["git", "config", "user.name"], { stdout: "pipe", stderr: "ignore" })
    return result.stdout.toString().trim() || "Me"
  } catch {
    return "Me"
  }
}
