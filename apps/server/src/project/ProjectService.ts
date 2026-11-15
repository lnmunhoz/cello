// Projects: one product each, with a globally unique task key (`THAI`) and its own task numbers.
import type { Project, ProjectRef } from "@cello/contract/entities"
import { Invalid, KeyTaken, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import { freeProjectKey, isValidProjectKey } from "@cello/shared/taskKey"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectProjects } from "../persistence/rows.ts"
import { requireColor, requireText } from "../validation.ts"

/** New projects without a color take the next one from this list. */
export const PROJECT_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"]

export interface CreateProject {
  readonly commandId: string
  readonly workspaceId: string
  readonly name: string
  /** Without one, the project gets a free key made from its name (`freeProjectKey`). */
  readonly key?: string
  readonly color?: string
  readonly repoPath?: string
}

export interface UpdateProject {
  readonly commandId: string
  readonly id: string
  readonly name?: string
  readonly color?: string
  readonly description?: string
}

export class ProjectService extends Context.Service<ProjectService, {
  readonly create: (input: CreateProject) => Effect.Effect<Commands.Written<Project>, NotFound | Invalid | KeyTaken, Caller>
  readonly update: (input: UpdateProject) => Effect.Effect<Commands.Written<Project>, NotFound | Invalid, Caller>
  readonly archive: (input: { readonly commandId: string; readonly id: string }) => Effect.Effect<
    Commands.Written<Project>,
    NotFound,
    Caller
  >
  /** The non-archived project a CLI call names: by key if given, else by its repository folder. */
  readonly resolve: (ref: ProjectRef) => Effect.Effect<Project, NotFound | Invalid>
}>()("cello/ProjectService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands

  const load = (id: string) =>
    selectProjects(sql, sql`p.id = ${id}`).pipe(
      Effect.flatMap((rows) => rows[0] ? Effect.succeed(rows[0]) : Effect.fail(new NotFound({ entity: "project", id }))),
    )

  const create = Effect.fn("ProjectService.create")(function* (input: CreateProject) {
    const name = yield* requireText("name", input.name)
    const given = input.key?.trim().toUpperCase()
    if (given !== undefined && !isValidProjectKey(given)) {
      return yield* new Invalid({ field: "key", reason: "must be 2 to 10 letters or digits, starting with a letter" })
    }
    const color = input.color === undefined ? undefined : yield* requireColor("color", input.color)
    const repoPath = input.repoPath === undefined ? undefined : yield* requireText("repoPath", input.repoPath)

    return yield* commands.write({ commandId: input.commandId, rpc: "project.create" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const workspaces = yield* sql<{ id: string }>`
          SELECT id FROM workspaces WHERE id = ${input.workspaceId} AND archived_at IS NULL`
        if (!workspaces[0]) return yield* new NotFound({ entity: "workspace", id: input.workspaceId })
        // Keys are unique across workspaces, archived projects included.
        const taken = given === undefined ? new Set((yield* sql<{ key: string }>`SELECT key FROM projects`).map((r) => r.key)) : new Set()
        const key = given ?? freeProjectKey(name, (k) => taken.has(k))
        const holders = yield* sql<{ name: string }>`SELECT name FROM projects WHERE key = ${key}`
        if (holders[0]) return yield* new KeyTaken({ key, projectName: holders[0].name })
        if (repoPath !== undefined) {
          const repos = yield* sql<{ name: string }>`
            SELECT p.name FROM project_repos r JOIN projects p ON p.id = r.project_id WHERE r.path = ${repoPath}`
          if (repos[0]) return yield* new Invalid({ field: "repoPath", reason: `already used by ${repos[0].name}` })
        }
        const [{ count }] = (yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM projects`) as [{ count: number }]
        const id = newId(now)
        yield* sql`INSERT INTO projects (id, workspace_id, name, key, color, description, created_at, updated_at)
          VALUES (${id}, ${input.workspaceId}, ${name}, ${key}, ${color ?? PROJECT_COLORS[count % PROJECT_COLORS.length]!},
                  '', ${now}, ${now})`
        if (repoPath !== undefined) {
          yield* sql`INSERT INTO project_repos (id, project_id, path, git_remote, is_main, created_at, updated_at)
            VALUES (${newId(now)}, ${id}, ${repoPath}, NULL, 1, ${now}, ${now})`
        }
        const project = yield* load(id)
        yield* emit({ type: "project.created", project }, { workspaceId: project.workspaceId, projectId: id })
        return project
      }))
  })

  const update = Effect.fn("ProjectService.update")(function* (input: UpdateProject) {
    const next = {
      ...(input.name === undefined ? {} : { name: yield* requireText("name", input.name) }),
      ...(input.color === undefined ? {} : { color: yield* requireColor("color", input.color) }),
      ...(input.description === undefined ? {} : { description: input.description }),
    }
    return yield* commands.write({ commandId: input.commandId, rpc: "project.update" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        const before: Record<string, string> = {}
        const after: Record<string, string> = {}
        for (const [field, value] of Object.entries(next) as Array<[keyof typeof next, string]>) {
          if (current[field] !== value) {
            before[field] = current[field]
            after[field] = value
          }
        }
        if (Object.keys(after).length === 0) return current
        yield* sql`UPDATE projects SET ${sql.update({ ...after, updated_at: now })} WHERE id = ${current.id}`
        yield* emit(
          { type: "project.updated", id: current.id, before, after },
          { workspaceId: current.workspaceId, projectId: current.id },
        )
        return yield* load(current.id)
      }))
  })

  const archive = Effect.fn("ProjectService.archive")(function* (input: { readonly commandId: string; readonly id: string }) {
    return yield* commands.write({ commandId: input.commandId, rpc: "project.archive" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* load(input.id)
        if (current.archivedAt !== null) return current
        yield* sql`UPDATE projects SET archived_at = ${now}, updated_at = ${now} WHERE id = ${current.id}`
        yield* emit({ type: "project.archived", id: current.id }, { workspaceId: current.workspaceId, projectId: current.id })
        return yield* load(current.id)
      }))
  })

  const resolve = Effect.fn("ProjectService.resolve")(function* (ref: ProjectRef) {
    const key = ref.key?.trim().toUpperCase()
    if (key) {
      const rows = yield* selectProjects(sql, sql`p.key = ${key} AND p.archived_at IS NULL`)
      return rows[0] ?? (yield* new NotFound({ entity: "project", id: key }))
    }
    if (ref.repoPath) {
      const rows = yield* selectProjects(sql, sql`p.archived_at IS NULL AND p.id IN (
        SELECT project_id FROM project_repos WHERE path = ${ref.repoPath})`)
      return rows[0] ?? (yield* new NotFound({ entity: "project", id: ref.repoPath }))
    }
    return yield* new Invalid({ field: "project", reason: "name a project by key or by its repository folder" })
  }, Effect.catchTag("SqlError", Effect.die))

  return ProjectService.of({ create, update, archive, resolve })
})

export const layer = Layer.effect(ProjectService, make)
