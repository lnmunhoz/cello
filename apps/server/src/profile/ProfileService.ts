// A project's testing profile (CEL-89): how to install, test, start the app and collect evidence in its
// repo. It's current best knowledge that changes with the repo: `cello init` drafts it from detection,
// agents fix fields when a command fails or the repo changes, and the human edits it in Settings. Each
// field keeps who set it and when; each change is one `profile.changed` event in the same transaction.
//
// Who may overwrite what:
// - the human overwrites anything
// - an agent overwrites detected and agent fields, never the human's (ProfileFieldLocked: ask him)
// - detection (`detected: true`) writes only fields that are unset or were detected before, keeps the
//   rest, and never unsets
import type { ProfileField, ProfileSource, ProjectRef, TestingProfile } from "@cello/contract/entities"
import { Invalid, NotFound, ProfileFieldLocked } from "@cello/contract/errors"
import type { Caller, ProfileWrite } from "@cello/contract/rpcs"
import { checkProfileValue, fieldOrder, profileFieldProblem } from "@cello/shared/testingProfile"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as Seed from "../persistence/Seed.ts"
import * as ProjectService from "../project/ProjectService.ts"

export interface SetProfile {
  readonly commandId: string
  readonly project: ProjectRef
  readonly set: ReadonlyArray<{ readonly field: string; readonly value: string }>
  readonly unset?: ReadonlyArray<string>
  readonly detected?: boolean
}

export class ProfileService extends Context.Service<ProfileService, {
  readonly get: (ref: ProjectRef) => Effect.Effect<TestingProfile, NotFound | Invalid>
  readonly set: (input: SetProfile) => Effect.Effect<Commands.Written<ProfileWrite>, NotFound | Invalid | ProfileFieldLocked, Caller>
}>()("cello/ProfileService") {}

interface FieldRow {
  field: string
  value: string
  source: ProfileSource
  actor_id: string
  session_id: string | null
  updated_at: number
}

const toField = (r: FieldRow): ProfileField => ({
  field: r.field,
  value: r.value,
  source: r.source,
  updatedAt: r.updated_at,
  actorId: r.actor_id,
  sessionId: r.session_id,
})

const byOrder = (a: ProfileField, b: ProfileField) => fieldOrder(a.field) - fieldOrder(b.field) || a.field.localeCompare(b.field)

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const projects = yield* ProjectService.ProjectService
  const human = yield* Seed.HumanActor

  const fieldsOf = (projectId: string) =>
    sql<FieldRow>`SELECT field, value, source, actor_id, session_id, updated_at FROM profile_fields WHERE project_id = ${projectId}`.pipe(
      Effect.map((rows) => rows.map(toField).sort(byOrder)),
    )

  const get = Effect.fn("ProfileService.get")(function* (ref: ProjectRef) {
    const project = yield* projects.resolve(ref)
    return { projectId: project.id, fields: yield* fieldsOf(project.id) }
  }, Effect.catchTag("SqlError", Effect.die))

  const set = Effect.fn("ProfileService.set")(function* (input: SetProfile) {
    const unset = [...new Set(input.unset ?? [])]
    if (input.detected && unset.length > 0) return yield* new Invalid({ field: "unset", reason: "detected values only fill fields; they never unset one" })
    const wanted = new Map<string, string | null>()
    for (const { field, value } of input.set) {
      const problem = profileFieldProblem(field)
      if (problem !== null) return yield* new Invalid({ field, reason: problem })
      const checked = checkProfileValue(field, value)
      if ("problem" in checked) return yield* new Invalid({ field, reason: checked.problem })
      wanted.set(field, checked.value)
    }
    for (const field of unset) {
      const problem = profileFieldProblem(field)
      if (problem !== null) return yield* new Invalid({ field, reason: problem })
      wanted.set(field, null)
    }
    const project = yield* projects.resolve(input.project)

    return yield* commands.write({ commandId: input.commandId, rpc: "profile.set" }, ({ now, caller, emit }) =>
      Effect.gen(function* () {
        const source: ProfileSource = input.detected ? "detected" : caller.sessionId === null ? "human" : "agent"
        const current = new Map((yield* fieldsOf(project.id)).map((f) => [f.field, f]))
        const changes: Array<{ field: string; before: ProfileField | null; after: ProfileField | null }> = []
        const written: string[] = []
        const kept: string[] = []
        for (const [field, value] of wanted) {
          const before = current.get(field) ?? null
          if (before === null && value === null) continue
          if (before !== null && before.source !== "detected" && source === "detected") {
            kept.push(field)
            continue
          }
          if (before?.source === "human" && source === "agent") {
            if (before.value === value) {
              kept.push(field)
              continue
            }
            return yield* new ProfileFieldLocked({ field, value: before.value, human: human.name })
          }
          if (value === null) {
            yield* sql`DELETE FROM profile_fields WHERE project_id = ${project.id} AND field = ${field}`
            changes.push({ field, before, after: null })
            written.push(field)
            continue
          }
          const after: ProfileField = { field, value, source, updatedAt: now, actorId: caller.actorId, sessionId: caller.sessionId }
          yield* sql`INSERT INTO profile_fields (project_id, field, value, source, actor_id, session_id, updated_at)
            VALUES (${project.id}, ${field}, ${value}, ${source}, ${caller.actorId}, ${caller.sessionId}, ${now})
            ON CONFLICT (project_id, field) DO UPDATE SET value = excluded.value, source = excluded.source,
              actor_id = excluded.actor_id, session_id = excluded.session_id, updated_at = excluded.updated_at`
          changes.push({ field, before, after })
          written.push(field)
        }
        if (changes.length > 0) {
          yield* emit({ type: "profile.changed", project: project.id, changes }, { workspaceId: project.workspaceId, projectId: project.id })
        }
        return { profile: { projectId: project.id, fields: yield* fieldsOf(project.id) }, written, kept }
      }))
  })

  return ProfileService.of({ get, set })
})

export const layer = Layer.effect(ProfileService, make)
