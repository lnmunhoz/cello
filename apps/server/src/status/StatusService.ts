// Statuses: the workspace's board columns, shared by its projects.
import type { Status } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { selectStatuses } from "../persistence/rows.ts"
import { place } from "../position/placement.ts"
import { placed, requireColor, requireText } from "../validation.ts"

export interface UpdateStatus {
  readonly commandId: string
  readonly id: string
  readonly name?: string
  readonly color?: string
  readonly hidden?: boolean
  /** The status that should sit right before this one. */
  readonly before?: string | null
  /** The status that should sit right after this one. */
  readonly after?: string | null
}

export class StatusService extends Context.Service<StatusService, {
  readonly update: (input: UpdateStatus) => Effect.Effect<Commands.Written<Status>, NotFound | Invalid, Caller>
}>()("cello/StatusService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands

  const load = (id: string) =>
    selectStatuses(sql, sql`s.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "status", id }))),
    )

  const update = Effect.fn("StatusService.update")(function* (input: UpdateStatus) {
    const name = input.name === undefined ? undefined : yield* requireText("name", input.name)
    const color = input.color === undefined ? undefined : yield* requireColor("color", input.color)
    const moving = input.before !== undefined || input.after !== undefined

    return yield* commands.write({ commandId: input.commandId, rpc: "status.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const next: { name?: string; color?: string; hidden?: boolean; position?: string } = {}
        if (name !== undefined && name !== current.name) {
          const clash = yield* sql<{ id: string }>`
            SELECT id FROM statuses WHERE workspace_id = ${current.workspaceId} AND name = ${name} AND id != ${current.id}`
          if (clash[0]) return yield* new Invalid({ field: "name", reason: `${name} is already a status` })
          next.name = name
        }
        if (color !== undefined && color !== current.color) next.color = color
        if (input.hidden !== undefined && input.hidden !== current.hidden) next.hidden = input.hidden
        if (moving) {
          const siblings = yield* sql<{ id: string; position: string }>`
            SELECT id, position FROM statuses WHERE workspace_id = ${current.workspaceId}`
          const { position, unchanged } = yield* placed(
            place(siblings, { self: current, before: input.before, after: input.after }),
          )
          if (!unchanged) next.position = position
        }
        const fields = Object.keys(next) as Array<keyof typeof next>
        if (fields.length === 0) return current

        const before = Object.fromEntries(fields.map((f) => [f, current[f]]))
        const columns = { ...next, ...(next.hidden === undefined ? {} : { hidden: next.hidden ? 1 : 0 }) }
        yield* sql`UPDATE statuses SET ${sql.update({ ...columns, updated_at: now })} WHERE id = ${current.id}`
        yield* emit(
          { type: "status.updated", id: current.id, before, after: next },
          { workspaceId: current.workspaceId, projectId: null },
        )
        return yield* load(current.id)
      }))
  })

  return StatusService.of({ update })
})

export const layer = Layer.effect(StatusService, make)
