// The human actor's name on first start: `git config user.name`, else "Human".

/** The human's name when git has none: a role, never a person's name. */
export const HUMAN_FALLBACK_NAME = "Human"

/** The name from `git config user.name`'s output, or the fallback when it's empty. */
export const humanNameFrom = (gitOutput: string): string => gitOutput.trim() || HUMAN_FALLBACK_NAME

export const gitUserName = (): string => {
  try {
    const result = Bun.spawnSync(["git", "config", "user.name"], { stdout: "pipe", stderr: "ignore" })
    return humanNameFrom(result.stdout.toString())
  } catch {
    return HUMAN_FALLBACK_NAME
  }
}
