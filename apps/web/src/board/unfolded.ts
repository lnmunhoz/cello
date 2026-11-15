// The hidden columns you unfolded on a project's board, remembered on this device so a reload keeps them open.

export const unfoldedKey = (projectKey: string): string => `cello:board-unfolded:${projectKey.toUpperCase()}`

/** The saved status ids; nothing saved, or anything broken, is none. */
export const readUnfolded = (stored: string | null): string[] => {
  try {
    const parsed: unknown = stored === null ? [] : JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}
