// Labels: each belongs to one project (CEL-80), and names are unique within it. Each label is in a group
// (kind, area, milestone or none, CEL-52), which the Issues tab's filter groups by. A label's events are
// its project's, so a project subscription gets them and another project's doesn't.
import type { Label, LabelGroup } from "@cello/contract/entities"
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
  readonly projectId: string
  readonly name: string
  readonly color: string
  /** `none` when left out. */
  readonly group?: LabelGroup
}

export interface UpdateLabel {
  readonly commandId: string
  readonly id: string
  readonly name?: string
  readonly color?: string
  readonly group?: LabelGroup
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

  /** Names are unique in the project ignoring case, archived labels included ("Board" and "board" are one label). */
  const ensureNameFree = (projectId: string, name: string, exceptId: string | null) =>
    sql<{ id: string; name: string; archived_at: number | null }>`
      SELECT id, name, archived_at FROM labels WHERE project_id = ${projectId} AND lower(name) = lower(${name})`.pipe(
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
        const projects = yield* sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${input.projectId}`
        if (!projects[0]) return yield* new NotFound({ entity: "project", id: input.projectId })
        yield* ensureNameFree(input.projectId, name, null)
        const id = newId(now)
        yield* sql`INSERT INTO labels (id, workspace_id, project_id, name, color, label_group, created_at, updated_at)
          VALUES (${id}, ${projects[0].workspace_id}, ${input.projectId}, ${name}, ${color}, ${input.group ?? "none"}, ${now}, ${now})`
        const label = yield* load(id)
        yield* emit({ type: "label.created", label }, { workspaceId: label.workspaceId, projectId: label.projectId })
        return label
      }))
  })

  const update = Effect.fn("LabelService.update")(function* (input: UpdateLabel) {
    const name = input.name === undefined ? undefined : yield* requireText("name", input.name)
    const color = input.color === undefined ? undefined : yield* requireColor("color", input.color)
    return yield* commands.write({ commandId: input.commandId, rpc: "label.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const before: { name?: string; color?: string; group?: LabelGroup } = {}
        const after: { name?: string; color?: string; group?: LabelGroup } = {}
        if (name !== undefined && name !== current.name) {
          yield* ensureNameFree(current.projectId, name, current.id)
          before.name = current.name
          after.name = name
        }
        if (color !== undefined && color !== current.color) {
          before.color = current.color
          after.color = color
        }
        if (input.group !== undefined && input.group !== current.group) {
          before.group = current.group
          after.group = input.group
        }
        if (Object.keys(after).length === 0) return current
        const { group, ...columns } = after
        yield* sql`UPDATE labels SET ${sql.update({ ...columns, ...(group === undefined ? {} : { label_group: group }), updated_at: now })}
          WHERE id = ${current.id}`
        yield* emit(
          { type: "label.updated", id: current.id, before, after },
          { workspaceId: current.workspaceId, projectId: current.projectId },
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
        yield* emit({ type: "label.archived", id: current.id }, { workspaceId: current.workspaceId, projectId: current.projectId })
        return yield* load(current.id)
      }))
  })

  return LabelService.of({ create, update, archive })
})

export const layer = Layer.effect(LabelService, make)
