// Where a task is inside In Progress (CEL-35, CEL-105): every session holding a claim sets the stage with
// `cello task stage`. A session working by itself goes planning (when the task needs a decision before
// code) → building → merged; an orchestrator
// marks each step of a feature's lifecycle, building → review → fixing → merged (docs/feature-lifecycle.md).
// In a project that merges after approval (CEL-143), Lucas's Approve sets `merging` on the task in In
// Review instead of moving it to Done; only Approve sets it, and a stage on an In Review task means
// exactly that: approved, waiting for its agent to merge (packages/domain/src/review.ts, `awaitsMerge`).
// A task with no stage whose agent is active shows as Working on the board: not a stage, nobody sets it,
// the web app works it out (apps/web/src/presence/model.ts). The one list every part reads:
// the server validates against it, the CLI names it in help and errors, the web app draws a word, an
// icon and a lane per entry, in this order. Add a stage here and it shows up everywhere.
import * as Schema from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"

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
  { id: "planning", label: "Planning", icon: "list-checks", color: "#EC4899", when: "the task needs a decision before code: a spec, a scope with options, or a question to the human" },
  { id: "building", label: "Building", icon: "hammer", color: "#0EA5E9", when: "the code is being written, by you or a builder agent" },
  { id: "review", label: "Agent review", icon: "scan-eye", color: "#6366F1", when: "a reviewer agent is reading the branch" },
  { id: "fixing", label: "Fixing findings", icon: "wrench", color: "#F59E0B", when: "the builder is fixing what the review found" },
  { id: "merged", label: "Merged", icon: "git-merge", color: "#10B981", when: "merged into main; the packet comes next" },
  {
    id: "merging",
    label: "Approved · merging",
    icon: "git-pull-request-arrow",
    color: "#22C55E",
    when: "set by the human's Approve (on the Review page, or relayed from their chat with `cello task approve`) in a project that merges after approval (the task stays in In Review); merge and deploy, then `cello task done`",
  },
] as const satisfies ReadonlyArray<StageInfo>

export type TaskStage = (typeof TASK_STAGES)[number]["id"]

export const STAGE_IDS: ReadonlyArray<TaskStage> = TASK_STAGES.map((s) => s.id)

/** The stages an agent sets with `cello task stage`: all but `merging`, which only the human's Approve sets, or an approval relayed from their chat (CEL-143, CEL-169). */
export const AGENT_STAGE_IDS: ReadonlyArray<TaskStage> = STAGE_IDS.filter((id) => id !== "merging")

/**
 * Stage names stored before a rename, read as the stage they became: `designing` ran on the live board
 * before it was renamed `planning` (CEL-105), and events keep what they recorded.
 */
const RENAMED: Readonly<Record<string, TaskStage>> = { designing: "planning" }

/** A stage, as stored and sent: one of the list, or an old name, which decodes to its new one. */
export const TaskStage = Schema.Literals([...STAGE_IDS, ...Object.keys(RENAMED)]).pipe(
  Schema.decodeTo(
    Schema.Literals(STAGE_IDS),
    SchemaTransformation.transform({ decode: (id: string) => (RENAMED[id] ?? id) as TaskStage, encode: (id: TaskStage): string => id }),
  ),
)

/** A stage's entry, or undefined for a name that isn't one. */
export const stageInfo = (id: string): StageInfo | undefined => TASK_STAGES.find((s) => s.id === id)

/** A stage's place in the list: lanes and sorts follow it. */
export const stageRank = (id: string | null): number => {
  const at = id === null ? -1 : STAGE_IDS.indexOf(id as TaskStage)
  return at === -1 ? STAGE_IDS.length : at
}
