/** A JSON object (or any plain object), not null and not an array: what a parsed settings file, a draft or a transcript line holds. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
