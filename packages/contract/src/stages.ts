// Where a task is inside In Progress (CEL-35): the orchestrator sets the stage with `cello task stage`
// at each step of a feature's lifecycle (docs/feature-lifecycle.md). The one list every part reads:
// the server validates against it, the CLI names it in help and errors, the web app draws a word, an
// icon and a lane per entry, in this order. Add a stage here and it shows up everywhere.
import * as Schema from "effect/Schema"

export interface StageInfo {
  /** Stored on the task and typed in `cello task stage CEL-n <id>`. */
  readonly id: string
  /** What the board says: "Agent review". */
  readonly label: string
  /** A lucide icon name the web app maps to its component (`hammer`, `scan-eye`). */
  readonly icon: string
  /** Its color on the board, light and dark alike. */
  readonly color: string
  /** One line for `cello task stage --help` and docs/cli.md. */
  readonly when: string
}

export const TASK_STAGES = [
  { id: "designing", label: "Designing", icon: "pencil-ruler", color: "#EC4899", when: "brainstorming, writing the spec or making design options, before building" },
  { id: "building", label: "Building", icon: "hammer", color: "#0EA5E9", when: "a builder agent is writing the code" },
  { id: "review", label: "Agent review", icon: "scan-eye", color: "#6366F1", when: "a reviewer agent is reading the branch" },
  { id: "fixing", label: "Fixing findings", icon: "wrench", color: "#F59E0B", when: "the builder is fixing what the review found" },
  { id: "merged", label: "Merged", icon: "git-merge", color: "#10B981", when: "merged into main; the packet comes next" },
] as const satisfies ReadonlyArray<StageInfo>

export type TaskStage = (typeof TASK_STAGES)[number]["id"]

export const STAGE_IDS: ReadonlyArray<TaskStage> = TASK_STAGES.map((s) => s.id)

export const TaskStage = Schema.Literals(STAGE_IDS)

/** A stage's entry, or undefined for a name that isn't one. */
export const stageInfo = (id: string): StageInfo | undefined => TASK_STAGES.find((s) => s.id === id)

/** A stage's place in the list: lanes and sorts follow it. */
export const stageRank = (id: string | null): number => {
  const at = id === null ? -1 : STAGE_IDS.indexOf(id as TaskStage)
  return at === -1 ? STAGE_IDS.length : at
}
