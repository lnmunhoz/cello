import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"

/** A sortable position string between two neighbors (null = open end). Throws if a >= b. */
export const positionBetween = (before: string | null, after: string | null): string => {
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`positionBetween: ${before} must sort before ${after}`)
  }
  return generateKeyBetween(before, after)
}

/** `count` increasing positions after `start` (null = from the beginning). */
export const positionsAfter = (start: string | null, count: number): string[] =>
  generateNKeysBetween(start, null, count)
