// Labels: per workspace, shared by its projects. Names are unique within the workspace.
import type { Label } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectLabels } from "../persistence/rows.ts"
import { requireColor, requireText } from "../validation.ts"

export interface CreateLabel {
  readonly commandId: string
  readonly workspaceId: string
  readonly name: string
  readonly color: string
}

export interface UpdateLabel {
  readonly commandId: string
  readonly id: string
  readonly name?: string
  readonly color?: string
}

export class LabelService extends Context.Service<LabelService, {
  readonly create: (input: CreateLabel) => Effect.Effect<Commands.Written<Label>, NotFound | Invalid, Caller>
  readonly update: (input: UpdateLabel) => Effect.Effect<Commands.Written<Label>, NotFound | Invalid, Caller>
  readonly archive: (input: { readonly commandId: string; readonly id: string }) => Effect.Effect<
    Commands.Written<Label>,
    NotFound,
    Caller
  >
}>()("cello/LabelService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands

  const load = (id: string) =>
    selectLabels(sql, sql`l.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "label", id }))),
    )

  /** Names are unique in the workspace ignoring case, archived labels included ("Board" and "board" are one label). */
  const ensureNameFree = (workspaceId: string, name: string, exceptId: string | null) =>
    sql<{ id: string; name: string; archived_at: number | null }>`
      SELECT id, name, archived_at FROM labels WHERE workspace_id = ${workspaceId} AND lower(name) = lower(${name})`.pipe(
      Effect.flatMap((rows) => {
        const taken = rows.find((r) => r.id !== exceptId)
        if (!taken) return Effect.void
        const which = taken.archived_at === null ? "a label" : "an archived label"
        return Effect.fail(new Invalid({ field: "name", reason: `there's already ${which} named "${taken.name}"` }))
      }),
    )

  const create = Effect.fn("LabelService.create")(function* (input: CreateLabel) {
    const name = yield* requireText("name", input.name)
    const color = yield* requireColor("color", input.color)
    return yield* commands.write({ commandId: input.commandId, rpc: "label.create" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const workspaces = yield* sql<{ id: string }>`SELECT id FROM workspaces WHERE id = ${input.workspaceId}`
        if (!workspaces[0]) return yield* new NotFound({ entity: "workspace", id: input.workspaceId })
        yield* ensureNameFree(input.workspaceId, name, null)
        const id = newId(now)
        yield* sql`INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at)
          VALUES (${id}, ${input.workspaceId}, ${name}, ${color}, ${now}, ${now})`
        const label = yield* load(id)
        yield* emit({ type: "label.created", label }, { workspaceId: label.workspaceId, projectId: null })
        return label
      }))
  })

  const update = Effect.fn("LabelService.update")(function* (input: UpdateLabel) {
    const name = input.name === undefined ? undefined : yield* requireText("name", input.name)
    const color = input.color === undefined ? undefined : yield* requireColor("color", input.color)
    return yield* commands.write({ commandId: input.commandId, rpc: "label.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const before: { name?: string; color?: string } = {}
        const after: { name?: string; color?: string } = {}
        if (name !== undefined && name !== current.name) {
          yield* ensureNameFree(current.workspaceId, name, current.id)
          before.name = current.name
          after.name = name
        }
        if (color !== undefined && color !== current.color) {
          before.color = current.color
          after.color = color
        }
        if (Object.keys(after).length === 0) return current
        yield* sql`UPDATE labels SET ${sql.update({ ...after, updated_at: now })} WHERE id = ${current.id}`
        yield* emit(
          { type: "label.updated", id: current.id, before, after },
          { workspaceId: current.workspaceId, projectId: null },
        )
        return yield* load(current.id)
      }))
  })

  const archive = Effect.fn("LabelService.archive")(function* (input: { readonly commandId: string; readonly id: string }) {
    return yield* commands.write({ commandId: input.commandId, rpc: "label.archive" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        if (current.archivedAt !== null) return current
        yield* sql`UPDATE labels SET archived_at = ${now}, updated_at = ${now} WHERE id = ${current.id}`
        yield* emit({ type: "label.archived", id: current.id }, { workspaceId: current.workspaceId, projectId: null })
        return yield* load(current.id)
      }))
  })

  return LabelService.of({ create, update, archive })
})

export const layer = Layer.effect(LabelService, make)
