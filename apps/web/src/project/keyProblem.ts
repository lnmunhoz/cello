import { isValidProjectKey, reservedKeyProblem } from "@cello/domain/taskKey"

/** Why a key can't be used, or null when it can. */
export const keyProblem = (key: string, taken: ReadonlyMap<string, string>): string | null => {
  if (key === "") return "Pick a key"
  if (!isValidProjectKey(key)) return "2–10 capital letters or digits, starting with a letter"
  const reserved = reservedKeyProblem(key)
  if (reserved !== null) return reserved[0]!.toUpperCase() + reserved.slice(1)
  const owner = taken.get(key)
  return owner ? `${key} is used by ${owner}` : null
}
