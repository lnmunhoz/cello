// Documents: docs, specs and pages. An agent publishes markdown with one command; the same slug, else
// the same source file, updates the page and keeps every version, so its link never changes. Files go
// into the attachments storage (`<dataDir>/assets/documents/<id>/`, served at /attachments/<id>) and
// the markdown's links to them are rewritten to those URLs. Tasks link by key; links are only added.
import * as path from "node:path"
import type { Document, DocumentFile, DocumentKind, DocumentSummary, DocumentVersion, Project, ProjectRef } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import type { Caller } from "@cello/contract/rpcs"
import type { DocumentList } from "@cello/contract/views"
import { attachmentPath } from "@cello/text/attachment"
import { isSlug, mapLinkTargets, slugify, summaryOf, titleFromFileName, titleOf, uniqueSlug } from "@cello/text/document"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type * as Statement from "effect/sql/Statement"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import { selectDocuments } from "../persistence/rows.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as AssetStore from "../review/AssetStore.ts"
import { type CheckedFile, checkFile } from "../review/evidence.ts"
import * as TaskService from "../task/TaskService.ts"
import { assetResolver } from "./assets.ts"

export interface PublishDocument {
  readonly commandId: string
  readonly project: ProjectRef
  readonly body: string
  readonly kind?: DocumentKind
  readonly slug?: string
  readonly title?: string
  readonly summary?: string
  /** The markdown file's absolute path. */
  readonly sourcePath?: string
  readonly taskKeys?: ReadonlyArray<string>
  /** Absolute paths on this machine. */
  readonly files?: ReadonlyArray<string>
}

export interface DocumentRef {
  readonly project: ProjectRef
  readonly slug: string
}

type Write<A, E> = Effect.Effect<Commands.Written<A>, E, Caller>

export class DocumentService extends Context.Service<DocumentService, {
  readonly publish: (input: PublishDocument) => Write<Document, NotFound | Invalid>
  /** The latest version, or `version`. */
  readonly get: (input: DocumentRef & { readonly version?: number }) => Effect.Effect<Document, NotFound | Invalid>
  /** A project's documents that aren't archived, newest first. */
  readonly list: (input: { readonly project: ProjectRef; readonly kind?: DocumentKind }) => Effect.Effect<DocumentList, NotFound | Invalid>
  /** Every version, newest first. */
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<DocumentVersion>, NotFound>
  readonly archive: (input: DocumentRef & { readonly commandId: string }) => Write<DocumentSummary, NotFound | Invalid>
  /** Documents linked to a task that aren't archived, newest first. */
  readonly ofTask: (taskId: string) => Effect.Effect<ReadonlyArray<DocumentSummary>>
}>()("cello/DocumentService") {}

interface VersionRow {
  document_id: string
  version: number
  kind: DocumentKind
  title: string
  summary: string
  body: string
  actor_id: string
  session_id: string | null
  created_at: number
  author_name: string
  author_color: string
  author_session: string | null
}

const unique = (values: ReadonlyArray<string>) => [...new Set(values)]

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const projects = yield* ProjectService.ProjectService
  const tasks = yield* TaskService.TaskService
  const assets = yield* AssetStore.AssetStore

  const first = (where: Statement.Fragment) => Effect.map(selectDocuments(sql, where), (rows) => rows[0])
  const bodyOf = (id: string) => Effect.map(sql<{ body: string }>`SELECT body FROM documents WHERE id = ${id}`, (rows) => rows[0]!.body)
  /** Every file the document's versions have published, oldest first. */
  const filesOf = (id: string) =>
    Effect.map(
      sql<{ id: string; kind: DocumentFile["kind"]; name: string; mime: string | null; poster_path: string | null }>`
        SELECT id, kind, name, mime, poster_path FROM attachments WHERE document_id = ${id} AND deleted_at IS NULL ORDER BY created_at, rowid`,
      (rows) => rows.map((r): DocumentFile => ({ id: r.id, kind: r.kind, name: r.name, mime: r.mime ?? "application/octet-stream", hasPoster: r.poster_path !== null })),
    )
  /** A document with its body (the latest version's, unless given) and its files. */
  const withBody = (document: DocumentSummary, body?: string) =>
    Effect.map(
      Effect.all([body === undefined ? bodyOf(document.id) : Effect.succeed(body), filesOf(document.id)]),
      ([text, files]): Document => ({ ...document, body: text, files }),
    )
  const bySlug = (project: Project, slug: string) => first(sql`d.project_id = ${project.id} AND d.slug = ${slug}`)
  const missing = (project: Project, slug: string) => new NotFound({ entity: "document", id: `${project.key}/${slug}` })

  /** Versions of a document with their authors; `version` picks one. */
  const versionRows = (documentId: string, version?: number) =>
    sql<VersionRow>`
      SELECT v.*, a.name AS author_name, a.color AS author_color, s.external_id AS author_session
      FROM document_versions v JOIN actors a ON a.id = v.actor_id LEFT JOIN agent_sessions s ON s.id = v.session_id
      WHERE ${sql.and([sql`v.document_id = ${documentId}`, ...(version === undefined ? [] : [sql`v.version = ${version}`])])}
      ORDER BY v.version DESC`

  /** The page to update: by slug when one is given, else by the source file it was published from. */
  const existingFor = (project: Project, slug: string | undefined, sourcePath: string | undefined) =>
    slug !== undefined
      ? bySlug(project, slug)
      : sourcePath !== undefined
      ? first(sql`d.project_id = ${project.id} AND d.source_path = ${sourcePath}`)
      : Effect.succeed(undefined)

  const freeSlug = (project: Project, base: string) =>
    Effect.map(
      sql<{ slug: string }>`SELECT slug FROM documents WHERE project_id = ${project.id} AND (slug = ${base} OR slug LIKE ${`${base}-%`})`,
      (rows) => {
        const taken = new Set(rows.map((r) => r.slug))
        return uniqueSlug(base, (s) => taken.has(s))
      },
    )

  const publish = Effect.fn("DocumentService.publish")(function* (input: PublishDocument) {
    const body = input.body.replace(/\r\n?/g, "\n")
    if (body.trim() === "") return yield* new Invalid({ field: "body", reason: "the document is empty" })
    const slug = input.slug?.trim()
    if (slug !== undefined && !isSlug(slug)) {
      return yield* new Invalid({ field: "slug", reason: `"${input.slug}" isn't a slug; use lowercase words joined by dashes, like billing-audit` })
    }
    const sourcePath = input.sourcePath
    if (sourcePath !== undefined && !path.isAbsolute(sourcePath)) {
      return yield* new Invalid({ field: "sourcePath", reason: `${sourcePath} isn't an absolute path` })
    }
    const files = yield* Effect.forEach(unique(input.files ?? []), (file) => checkFile(assets.sizeOf, { path: file }))
    const project = yield* projects.resolve(input.project)

    // Files copied so far, removed again if the command fails after copying.
    const copied: string[] = []
    return yield* commands.write({ commandId: input.commandId, rpc: "document.publish" }, ({ now, caller, emit }) =>
      Effect.gen(function* () {
        const linked = yield* Effect.forEach(unique((input.taskKeys ?? []).map((k) => k.trim().toUpperCase())), (key) => tasks.byKey(key))
        const existing = yield* existingFor(project, slug, sourcePath)
        const id = existing?.id ?? newId(now)

        // A file with the same name and content as one the page already has is that file.
        const fresh: Array<CheckedFile & { readonly id: string; readonly sha256: string }> = []
        const stored: Array<{ readonly path: string; readonly url: string }> = []
        for (const file of files) {
          const sha256 = yield* assets.hashOf(file.source)
          const [same] = existing === undefined ? [] : yield* sql<{ id: string }>`
            SELECT id FROM attachments WHERE document_id = ${id} AND name = ${path.basename(file.source)} AND sha256 = ${sha256}
              AND deleted_at IS NULL ORDER BY created_at LIMIT 1`
          const attachmentId = same?.id ?? newId(now)
          if (same === undefined) fresh.push({ ...file, id: attachmentId, sha256 })
          stored.push({ path: file.source, url: attachmentPath(attachmentId) })
        }

        const text = mapLinkTargets(body, assetResolver(sourcePath === undefined ? null : path.dirname(sourcePath), stored))
        const title = input.title?.trim() || titleOf(text) || (sourcePath === undefined ? "" : titleFromFileName(sourcePath)) || "Untitled"
        const summary = input.summary?.trim() ?? summaryOf(text)
        const kind = input.kind ?? existing?.kind ?? "page"
        const newLinks = linked.filter((t) => !existing?.tasks.some((l) => l.id === t.id))

        const saveVersion = (version: number) =>
          sql`INSERT INTO document_versions (document_id, version, kind, title, summary, body, actor_id, session_id, created_at)
            VALUES (${id}, ${version}, ${kind}, ${title}, ${summary}, ${text}, ${caller.actorId}, ${caller.sessionId}, ${now})`

        if (existing !== undefined) {
          const before = yield* bodyOf(id)
          const changed = before !== text || existing.title !== title || existing.summary !== summary || existing.kind !== kind
          if (!changed && existing.archivedAt === null && newLinks.length === 0) return yield* withBody(existing, before)
          // A new link or bringing back an archived page isn't a new version; changed content is.
          const version = changed ? existing.version + 1 : existing.version
          yield* sql`UPDATE documents SET kind = ${kind}, title = ${title}, summary = ${summary}, body = ${text}, version = ${version},
              source_path = COALESCE(${sourcePath ?? null}, source_path), updated_by_actor_id = ${caller.actorId},
              updated_by_session_id = ${caller.sessionId}, updated_at = ${now}, archived_at = NULL
            WHERE id = ${id}`
          if (changed) yield* saveVersion(version)
        } else {
          const newSlug = slug ?? (yield* freeSlug(project, slugify(title) || "page"))
          yield* sql`INSERT INTO documents (id, workspace_id, project_id, kind, slug, title, summary, body, source_path, version,
                                            created_by_actor_id, created_by_session_id, updated_by_actor_id, updated_by_session_id,
                                            created_at, updated_at)
            VALUES (${id}, ${project.workspaceId}, ${project.id}, ${kind}, ${newSlug}, ${title}, ${summary}, ${text}, ${sourcePath ?? null}, 1,
                    ${caller.actorId}, ${caller.sessionId}, ${caller.actorId}, ${caller.sessionId}, ${now}, ${now})`
          yield* saveVersion(1)
        }

        for (const file of fresh) {
          const relative = yield* assets.copyIn(file.source, path.join("documents", id), file.id)
          copied.push(relative)
          yield* sql`INSERT INTO attachments (id, document_id, kind, name, path, mime, bytes, sha256, actor_id, session_id, created_at)
            VALUES (${file.id}, ${id}, ${file.kind}, ${path.basename(file.source)}, ${relative}, ${file.mime}, ${file.bytes}, ${file.sha256},
                    ${caller.actorId}, ${caller.sessionId}, ${now})`
        }
        for (const task of newLinks) {
          yield* sql`INSERT INTO document_tasks (document_id, task_id, created_at) VALUES (${id}, ${task.id}, ${now})`
        }

        const document = (yield* first(sql`d.id = ${id}`))!
        const where = { workspaceId: project.workspaceId, projectId: project.id }
        if (existing === undefined) yield* emit({ type: "document.published", document }, where)
        else yield* emit({ type: "document.updated", id, version: document.version, document }, where)
        return yield* withBody(document, text)
      })).pipe(Effect.onError(() => assets.remove(copied)))
  })

  const get = Effect.fn("DocumentService.get")(function* (input: DocumentRef & { readonly version?: number }) {
    const project = yield* projects.resolve(input.project)
    const document = yield* bySlug(project, input.slug)
    if (document === undefined) return yield* missing(project, input.slug)
    if (input.version === undefined || input.version === document.version) return yield* withBody(document)
    const [row] = yield* versionRows(document.id, input.version)
    if (row === undefined) return yield* new NotFound({ entity: "document version", id: `${project.key}/${input.slug}@${input.version}` })
    return {
      ...document,
      version: row.version,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      body: row.body,
      files: yield* filesOf(document.id),
      updatedByActorId: row.actor_id,
      updatedBySessionId: row.session_id,
      updatedBy: { name: row.author_name, color: row.author_color, session: row.author_session },
      updatedAt: row.created_at,
    } satisfies Document
  }, Effect.catchTag("SqlError", Effect.die))

  const list = Effect.fn("DocumentService.list")(function* (input: { readonly project: ProjectRef; readonly kind?: DocumentKind }) {
    const project = yield* projects.resolve(input.project)
    const where = sql.and([sql`d.project_id = ${project.id}`, sql`d.archived_at IS NULL`, ...(input.kind === undefined ? [] : [sql`d.kind = ${input.kind}`])])
    return { project, documents: yield* selectDocuments(sql, where) }
  }, Effect.catchTag("SqlError", Effect.die))

  const history = Effect.fn("DocumentService.history")(function* (id: string) {
    const rows = yield* versionRows(id)
    if (rows.length === 0) return yield* new NotFound({ entity: "document", id })
    return rows.map((r): DocumentVersion => ({
      documentId: r.document_id,
      version: r.version,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      actorId: r.actor_id,
      sessionId: r.session_id,
      author: { name: r.author_name, color: r.author_color, session: r.author_session },
      createdAt: r.created_at,
    }))
  }, Effect.catchTag("SqlError", Effect.die))

  const archive = Effect.fn("DocumentService.archive")(function* (input: DocumentRef & { readonly commandId: string }) {
    const project = yield* projects.resolve(input.project)
    return yield* commands.write({ commandId: input.commandId, rpc: "document.archive" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const document = yield* bySlug(project, input.slug)
        if (document === undefined) return yield* missing(project, input.slug)
        if (document.archivedAt !== null) return document
        yield* sql`UPDATE documents SET archived_at = ${now} WHERE id = ${document.id}`
        yield* emit({ type: "document.archived", id: document.id }, { workspaceId: project.workspaceId, projectId: project.id })
        return { ...document, archivedAt: now }
      }))
  })

  const ofTask = Effect.fn("DocumentService.ofTask")(function* (taskId: string) {
    return yield* selectDocuments(sql, sql`d.archived_at IS NULL AND d.id IN (SELECT document_id FROM document_tasks WHERE task_id = ${taskId})`)
  }, Effect.orDie)

  return DocumentService.of({ publish, get, list, history, archive, ofTask })
})

export const layer = Layer.effect(DocumentService, make)
