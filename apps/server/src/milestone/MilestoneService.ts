// Milestones (CEL-113): a project's goals, each with an optional goal line and target date, in the order
// the human sets. Names are unique in the project, ignoring case. Agents may create and edit them;
// closing and reopening are the human's only (HumanOnly, like approving a review), so a milestone is
// never closed behind his back. Tasks join one with TaskService.setMilestone; progress is computed from
// them (@cello/domain/milestone), never stored. A milestone's events are its project's.
import type { Milestone } from "@cello/contract/entities"
import { HumanOnly, Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectMilestones } from "../persistence/rows.ts"
import * as Seed from "../persistence/Seed.ts"
import { place } from "../position/placement.ts"
import { requireText } from "../validation.ts"

export interface CreateMilestone {
  readonly commandId: string
  readonly projectId: string
  readonly name: string
  readonly goal?: string
  readonly targetDate?: string | null
}

export interface UpdateMilestone {
  readonly commandId: string
  readonly id: string
  readonly name?: string
  readonly goal?: string
  /** null clears it. */
  readonly targetDate?: string | null
  /** The milestone that should sit right above it, or right below it: a move in the project's order. */
  readonly before?: string | null
  readonly after?: string | null
}

type ById = { readonly commandId: string; readonly id: string }
type Write<E> = Effect.Effect<Commands.Written<Milestone>, E, Caller>

export class MilestoneService extends Context.Service<MilestoneService, {
  /** A new milestone, last in the project's order. */
  readonly create: (input: CreateMilestone) => Write<NotFound | Invalid>
  readonly update: (input: UpdateMilestone) => Write<NotFound | Invalid>
  /** The human's only; closing a closed one changes nothing. Its tasks stay in it. */
  readonly close: (input: ById) => Write<NotFound | HumanOnly>
  /** The human's only; reopening an open one changes nothing. */
  readonly reopen: (input: ById) => Write<NotFound | HumanOnly>
}>()("cello/MilestoneService") {}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A target date as YYYY-MM-DD, a real day; null clears it. */
const requireDate = (value: string | null): Effect.Effect<string | null, Invalid> => {
  if (value === null) return Effect.succeed(null)
  const trimmed = value.trim()
  const day = new Date(`${trimmed}T00:00:00Z`)
  return DATE.test(trimmed) && !Number.isNaN(day.getTime()) && day.toISOString().startsWith(trimmed)
    ? Effect.succeed(trimmed)
    : Effect.fail(new Invalid({ field: "targetDate", reason: `"${value}" isn't a date like 2026-12-01` }))
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const human = yield* Seed.HumanActor

  const load = (id: string) =>
    selectMilestones(sql, sql`m.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "milestone", id }))),
    )

  const projectOf = (projectId: string) =>
    sql<{ workspace_id: string; key: string }>`SELECT workspace_id, key FROM projects WHERE id = ${projectId}`.pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "project", id: projectId }))),
    )

  const siblings = (projectId: string) => sql<{ id: string; position: string }>`SELECT id, position FROM milestones WHERE project_id = ${projectId}`

  /** Names are unique in the project ignoring case, closed milestones included. */
  const ensureNameFree = (projectId: string, key: string, name: string, exceptId: string | null) =>
    sql<{ id: string; name: string }>`SELECT id, name FROM milestones WHERE project_id = ${projectId} AND lower(name) = lower(${name})`.pipe(
      Effect.flatMap((rows) => {
        const taken = rows.find((r) => r.id !== exceptId)
        return taken
          ? Effect.fail(new Invalid({ field: "name", reason: `there's already a milestone named "${taken.name}" in ${key}` }))
          : Effect.void
      }),
    )

  const create = Effect.fn("MilestoneService.create")(function* (input: CreateMilestone) {
    const name = yield* requireText("name", input.name)
    const targetDate = yield* requireDate(input.targetDate ?? null)
    return yield* commands.write({ commandId: input.commandId, rpc: "milestone.create" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const project = yield* projectOf(input.projectId)
        yield* ensureNameFree(input.projectId, project.key, name, null)
        const placement = place(yield* siblings(input.projectId), {})
        // No neighbors given: it can't name a bad one.
        if (placement._tag !== "Placed") return yield* Effect.die(new Error("placing a milestone last failed"))
        const id = newId(now)
        yield* sql`INSERT INTO milestones (id, project_id, name, goal, target_date, position, state, created_at, updated_at)
          VALUES (${id}, ${input.projectId}, ${name}, ${input.goal?.trim() ?? ""}, ${targetDate}, ${placement.position}, 'open', ${now}, ${now})`
        const milestone = yield* load(id)
        yield* emit({ type: "milestone.created", milestone }, { workspaceId: project.workspace_id, projectId: input.projectId })
        return milestone
      }))
  })

  const update = Effect.fn("MilestoneService.update")(function* (input: UpdateMilestone) {
    const name = input.name === undefined ? undefined : yield* requireText("name", input.name)
    const targetDate = input.targetDate === undefined ? undefined : yield* requireDate(input.targetDate)
    return yield* commands.write({ commandId: input.commandId, rpc: "milestone.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const project = yield* projectOf(current.projectId)
        const before: { name?: string; goal?: string; targetDate?: string | null; position?: string } = {}
        const after: typeof before = {}
        if (name !== undefined && name !== current.name) {
          yield* ensureNameFree(current.projectId, project.key, name, current.id)
          before.name = current.name
          after.name = name
        }
        const goal = input.goal?.trim()
        if (goal !== undefined && goal !== current.goal) {
          before.goal = current.goal
          after.goal = goal
        }
        if (targetDate !== undefined && targetDate !== current.targetDate) {
          before.targetDate = current.targetDate
          after.targetDate = targetDate
        }
        if (input.before !== undefined || input.after !== undefined) {
          const placement = place(yield* siblings(current.projectId), { self: current, before: input.before, after: input.after })
          if (placement._tag === "BadNeighbor") {
            const neighbor = placement.field === "before" ? input.before : input.after
            return yield* new Invalid({ field: placement.field, reason: `${neighbor} isn't another milestone of ${project.key}` })
          }
          if (!placement.unchanged) {
            before.position = current.position
            after.position = placement.position
          }
        }
        if (Object.keys(after).length === 0) return current
        const { targetDate: date, ...columns } = after
        yield* sql`UPDATE milestones SET ${sql.update({ ...columns, ...(date === undefined ? {} : { target_date: date }), updated_at: now })}
          WHERE id = ${current.id}`
        yield* emit({ type: "milestone.updated", id: current.id, before, after }, { workspaceId: project.workspace_id, projectId: current.projectId })
        return yield* load(current.id)
      }))
  })

  const setState = (rpc: "milestone.close" | "milestone.reopen", closing: boolean) =>
    Effect.fn(`MilestoneService.${closing ? "close" : "reopen"}`)(function* (input: ById) {
      return yield* commands.write({ commandId: input.commandId, rpc }, ({ now, caller, emit }) =>
        Effect.gen(function* () {
          // Like deciding a review: a milestone is done when the human says so.
          if (caller.sessionId !== null) {
            return yield* new HumanOnly({ action: closing ? "close a milestone" : "reopen a milestone", human: human.name })
          }
          const current = yield* load(input.id)
          if ((current.state === "closed") === closing) return current
          const project = yield* projectOf(current.projectId)
          yield* sql`UPDATE milestones SET state = ${closing ? "closed" : "open"}, closed_at = ${closing ? now : null}, updated_at = ${now}
            WHERE id = ${current.id}`
          yield* emit(
            closing ? { type: "milestone.closed", id: current.id } : { type: "milestone.reopened", id: current.id },
            { workspaceId: project.workspace_id, projectId: current.projectId },
          )
          return yield* load(current.id)
        }))
    })

  return MilestoneService.of({ create, update, close: setState("milestone.close", true), reopen: setState("milestone.reopen", false) })
})

export const layer = Layer.effect(MilestoneService, make)
