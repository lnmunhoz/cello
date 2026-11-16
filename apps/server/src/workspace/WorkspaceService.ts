// Workspaces: groups of projects that share statuses and views (labels are per project, CEL-80).
import type { Workspace } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import { positionBetween } from "@cello/shared/position"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectWorkspaces } from "../persistence/rows.ts"
import { insertDefaultStatuses } from "../status/defaults.ts"
import { requireText } from "../validation.ts"

/** Lowercase words joined by dashes; "workspace" when nothing is left. */
export const slugify = (name: string): string =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"

export class WorkspaceService extends Context.Service<WorkspaceService, {
  readonly create: (input: { readonly commandId: string; readonly name: string }) => Effect.Effect<
    Commands.Written<Workspace>,
    Invalid,
    Caller
  >
  readonly update: (input: { readonly commandId: string; readonly id: string; readonly name?: string }) => Effect.Effect<
    Commands.Written<Workspace>,
    NotFound | Invalid,
    Caller
  >
}>()("cello/WorkspaceService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands

  const load = (id: string) =>
    selectWorkspaces(sql, sql`w.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "workspace", id }))),
    )

  const create = Effect.fn("WorkspaceService.create")(function* (input: { readonly commandId: string; readonly name: string }) {
    const name = yield* requireText("name", input.name)
    return yield* commands.write({ commandId: input.commandId, rpc: "workspace.create" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const base = slugify(name)
        const taken = new Set(
          (yield* sql<{ slug: string }>`SELECT slug FROM workspaces WHERE slug = ${base} OR slug LIKE ${base + "-%"}`)
            .map((r) => r.slug),
        )
        let slug = base
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
        const [{ last }] = (yield* sql<{ last: string | null }>`SELECT MAX(position) AS last FROM workspaces`) as [
          { last: string | null },
        ]
        const id = newId(now)
        yield* sql`INSERT INTO workspaces (id, name, slug, position, created_at, updated_at)
          VALUES (${id}, ${name}, ${slug}, ${positionBetween(last, null)}, ${now}, ${now})`
        yield* insertDefaultStatuses(sql, id, now)
        const workspace = yield* load(id).pipe(Effect.catchTag("NotFound", Effect.die))
        yield* emit({ type: "workspace.created", workspace }, { workspaceId: id, projectId: null })
        return workspace
      }))
  })

  const update = Effect.fn("WorkspaceService.update")(function* (
    input: { readonly commandId: string; readonly id: string; readonly name?: string },
  ) {
    const name = input.name === undefined ? undefined : yield* requireText("name", input.name)
    return yield* commands.write({ commandId: input.commandId, rpc: "workspace.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        if (name === undefined || name === current.name) return current
        yield* sql`UPDATE workspaces SET name = ${name}, updated_at = ${now} WHERE id = ${current.id}`
        yield* emit(
          { type: "workspace.updated", id: current.id, before: { name: current.name }, after: { name } },
          { workspaceId: current.id, projectId: null },
        )
        return yield* load(current.id)
      }))
  })

  return WorkspaceService.of({ create, update })
})

export const layer = Layer.effect(WorkspaceService, make)
