// CEL-105 UI scope only, removed once Lucas picks: which design shows a task an agent works on with no
// stage. "A": a Working lane in In Progress (and the Working word on the card when lanes are off).
// "B": the lanes stay as they were ("No stage"), and the card says Working in its stage spot.
// Picked with `localStorage["cello:cel105-option"]`, read once at load; A unless it says B.
import { readStored } from "../lib/storage.ts"

export type WorkingOption = "A" | "B"

export const workingOption: WorkingOption = readStored("cello:cel105-option") === "B" ? "B" : "A"
