// Input checks shared by the services. Each returns the cleaned value or fails with `Invalid`.
import { Invalid } from "@cello/contract/errors"
import * as Effect from "effect/Effect"
import type { Placement } from "./position/placement.ts"

const COLOR = /^#[0-9A-Fa-f]{6}$/

/** A trimmed, non-empty name (or title). */
export const requireText = (field: string, value: string): Effect.Effect<string, Invalid> => {
  const trimmed = value.trim()
  return trimmed.length === 0
    ? Effect.fail(new Invalid({ field, reason: "can't be empty" }))
    : Effect.succeed(trimmed)
}

/** A `#RRGGBB` color. */
export const requireColor = (field: string, value: string): Effect.Effect<string, Invalid> =>
  COLOR.test(value)
    ? Effect.succeed(value.toUpperCase())
    : Effect.fail(new Invalid({ field, reason: "must be a color like #3B82F6" }))

/** The position from a placement, or `Invalid` naming the bad neighbor. */
export const placed = (placement: Placement): Effect.Effect<{ position: string; unchanged: boolean }, Invalid> =>
  placement._tag === "Placed"
    ? Effect.succeed(placement)
    : Effect.fail(new Invalid({ field: placement.field, reason: placement.reason }))
