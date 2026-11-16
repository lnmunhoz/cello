// Screenshots Lucas pastes or drops while he writes: into his answers to an ask (CEL-47) or into a
// comment box (CEL-73). Each is uploaded at once (POST /asks/<id>/uploads, POST /tasks/<id>/uploads) and
// stored as a draft attachment of its task (`answer_to = 'draft'`, with the ask's id for an answer), with
// no event: a draft isn't board state. Sending links the drafts to what they belong to, by id, each once.
// Drafts never sent are swept: an ask's a day after it closed, a comment box's a week after the upload.
import * as path from "node:path"
import { HumanOnly, Invalid } from "@cello/contract/errors"
import { Caller } from "@cello/contract/rpcs"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import type * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../persistence/ids.ts"
import { toAttachment } from "../persistence/rows.ts"
import type * as AssetStore from "../review/AssetStore.ts"

/** The image types Lucas can paste. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
/** How long a screenshot from answers never sent is kept after its ask closes. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000
/** How long a screenshot pasted into a comment box and never sent is kept: the box keeps its draft across reloads. */
export const COMMENT_DRAFT_TTL_MS = 7 * DRAFT_TTL_MS

export interface Upload {
  /** The file's name as pasted or dropped ("image.png"); its extension decides the type, and only its last part is kept. */
  readonly name: string
  readonly bytes: Uint8Array
}

/** Where a draft goes: its task, and the ask whose answers it's for (null: a comment box's). */
export interface DraftOwner {
  readonly taskId: string
  readonly askId: string | null
}

type Sql = SqlClient.SqlClient

export const make = (sql: Sql, assets: AssetStore.AssetStore["Service"], human: { readonly name: string }) => {
  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const stale = yield* sql<{ id: string; path: string | null }>`
      SELECT f.id, f.path FROM attachments f LEFT JOIN asks a ON a.id = f.ask_id
      WHERE f.answer_to = 'draft' AND f.deleted_at IS NULL AND (
        (f.ask_id IS NOT NULL AND a.state != 'open' AND f.created_at < ${now - DRAFT_TTL_MS})
        OR (f.ask_id IS NULL AND f.comment_id IS NULL AND f.created_at < ${now - COMMENT_DRAFT_TTL_MS}))`
    if (stale.length === 0) return 0
    yield* sql`UPDATE attachments SET deleted_at = ${now} WHERE ${sql.in("id", stale.map((f) => f.id))}`
    yield* assets.remove(stale.flatMap((f) => (f.path === null ? [] : [f.path])))
    return stale.length
  }).pipe(Effect.orDie, Effect.withSpan("Drafts.sweep"))

  /**
   * Stores a pasted screenshot as a draft of `owner` (found after the checks: who, what type, how big).
   * Human only. The file goes to `<taskId>/<new id><ext>` in the assets folder, whatever the name says.
   */
  const store = <E>(upload: Upload, action: string, owner: Effect.Effect<DraftOwner, E>) =>
    Effect.gen(function* () {
      const caller = yield* Caller
      if (caller.sessionId !== null) return yield* new HumanOnly({ action, human: human.name })
      const name = path.basename(upload.name)
      const ext = path.extname(name).toLowerCase()
      const mime = UPLOAD_TYPES[ext]
      if (mime === undefined) return yield* new Invalid({ field: "file", reason: `${name} isn't a PNG, JPEG, GIF or WebP image` })
      if (upload.bytes.byteLength > MAX_UPLOAD_BYTES) {
        return yield* new Invalid({ field: "file", reason: `${name} is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` })
      }
      yield* sweep
      const { taskId, askId } = yield* owner
      const now = yield* Clock.currentTimeMillis
      const id = newId(now)
      const relative = yield* assets.writeIn(upload.bytes, taskId, id, ext)
      yield* sql`INSERT INTO attachments (id, task_id, ask_id, answer_to, kind, name, path, mime, bytes, actor_id, created_at)
        VALUES (${id}, ${taskId}, ${askId}, 'draft', 'image', ${name}, ${relative}, ${mime}, ${upload.bytes.byteLength}, ${caller.actorId}, ${now})`
        .pipe(Effect.onError(() => assets.remove([relative])))
      const [row] = yield* sql<Parameters<typeof toAttachment>[0]>`SELECT * FROM attachments WHERE id = ${id}`
      return toAttachment(row!)
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  /**
   * Checks the ids a send names against the drafts it may use (`available`): each one of them, each
   * used once across every call on the same `used` set. Returns the ids, in order.
   */
  const take = (ids: ReadonlyArray<string>, available: ReadonlyArray<string>, used: Set<string>, owner: string) =>
    Effect.gen(function* () {
      for (const id of ids) {
        if (used.has(id) || !available.includes(id)) {
          return yield* new Invalid({ field: "attachmentIds", reason: `screenshot ${id} isn't a draft of ${owner}, or is used twice` })
        }
        used.add(id)
      }
      return ids
    })

  return { sweep, store, take }
}

export type Drafts = ReturnType<typeof make>
