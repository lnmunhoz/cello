import { isValidProjectKey } from "@cello/shared/taskKey"

/** Why a key can't be used, or null when it can. */
export const keyProblem = (key: string, taken: ReadonlyMap<string, string>): string | null => {
  if (key === "") return "Pick a key"
  if (!isValidProjectKey(key)) return "2–10 capital letters or digits, starting with a letter"
  const owner = taken.get(key)
  return owner ? `${key} is used by ${owner}` : null
}
