// Review packets on the client: the queue the Review page shows, where evidence is served, and a
// task's loaded review list kept current from the event stream.
import type { Attachment, Project, Review, Task } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { attachmentPath } from "@cello/shared/attachment"
import { shortUrl } from "@cello/shared/linkify"
import { awaitsMerge, holdsPacket, isReviewStatus } from "@cello/shared/review"
import type { BoardState } from "./applyEvents.ts"

export interface ReviewItem {
  readonly task: Task
  readonly project: Project
  /** Null for a task moved to In Review by hand, without a packet. */
  readonly review: Review | null
}

/**
 * Whether an open review is waiting on Lucas: its task is in In Review, or in Needs input when the
 * agent asked from there. A packet left open on a task that moved on before CEL-71 isn't: no badge,
 * no pinned packet to approve, no "waiting: review" match (the server refuses to decide it, too).
 */
const waiting = (state: BoardState, review: Review): boolean => {
  const task = state.tasks[review.taskId]
  const status = task ? state.statuses[task.statusId] : undefined
  return status !== undefined && holdsPacket(status)
}

/** A task's open review, if it has one waiting on Lucas. */
export const openReviewOf = (state: BoardState, taskId: string): Review | undefined =>
  Object.values(state.reviews).find((r) => r.taskId === taskId && waiting(state, r))

/**
 * Every packet waiting on Lucas in a workspace: tasks with an open review (oldest packet first), then
 * tasks sitting in In Review without one (oldest task first). Neither order changes while a row waits. Archived tasks and projects are left out, and so are tasks
 * waiting on his answers to an ask (CEL-47): the Needs input group shows those first. So are tasks he
 * approved that wait for their agent to merge them (Approved · merging, CEL-143): they wait on the agent.
 */
export const reviewQueue = (state: BoardState, workspaceId: string): ReviewItem[] => {
  const projectOf = (task: Task) => {
    const project = state.projects[task.projectId]
    return project && project.workspaceId === workspaceId && project.archivedAt === null ? project : undefined
  }
  const withPacket: ReviewItem[] = []
  // Asked about: shown in the Needs input group instead.
  const reviewed = new Set<string>(Object.values(state.asks).map((a) => a.taskId))
  for (const review of Object.values(state.reviews).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))) {
    const task = state.tasks[review.taskId]
    const project = task && task.archivedAt === null && waiting(state, review) ? projectOf(task) : undefined
    if (!task || !project || reviewed.has(task.id)) continue
    reviewed.add(task.id)
    withPacket.push({ task, project, review })
  }
  const without = Object.values(state.tasks)
    .filter((t) => {
      const status = state.statuses[t.statusId]
      return t.archivedAt === null && !reviewed.has(t.id) && isReviewStatus(status?.name ?? "") && !awaitsMerge(t, status)
    })
    // By nothing that changes while they wait (CEL-187): `updatedAt` moved a row on every comment or
    // label. The board state doesn't hold when a task entered In Review, so: oldest task first.
    .sort((a, b) => a.createdAt - b.createdAt || a.number - b.number || (a.id < b.id ? -1 : 1))
    .flatMap((task) => {
      const project = projectOf(task)
      return project ? [{ task, project, review: null }] : []
    })
  return [...withPacket, ...without]
}

export const attachmentUrl = (attachment: Pick<Attachment, "id">): string => attachmentPath(attachment.id)

export const posterUrl = (attachment: Pick<Attachment, "id" | "hasPoster">): string | undefined =>
  attachment.hasPoster ? `${attachmentPath(attachment.id)}/poster` : undefined

/**
 * A packet's thumbnail. A card shows the first video's poster, else the first screenshot; a Review row
 * (`prefer: "screenshot"`) the other way round, since a poster can be the video's blank first frame.
 */
export const thumbnailOf = (review: Review, prefer: "poster" | "screenshot" = "poster"): string | null => {
  const video = review.attachments.find((a) => a.kind === "video" && a.hasPoster)
  const image = review.attachments.find((a) => a.kind === "image")
  const poster = video ? posterUrl(video)! : null
  const screenshot = image ? attachmentUrl(image) : null
  return prefer === "poster" ? (poster ?? screenshot) : (screenshot ?? poster)
}

const EVIDENCE_ORDER: ReadonlyArray<Attachment["kind"]> = ["video", "image", "file", "link"]

/** A packet's evidence in the order the packet shows it: videos, then screenshots, files and links. */
export const evidenceInOrder = (attachments: ReadonlyArray<Attachment>): Attachment[] =>
  EVIDENCE_ORDER.flatMap((kind) => attachments.filter((a) => a.kind === kind))

/** What a card's evidence badge opens. */
export const firstEvidence = (review: Review): Attachment | undefined => evidenceInOrder(review.attachments)[0]

/** What the viewer opens for a piece of evidence: the served file or the link, titled by its caption. */
export interface EvidenceTarget {
  readonly url: string
  readonly title: string
  /**
   * Set for a stored file: an image or a video, else text (the server stores only those: transcripts,
   * logs, markdown, JSON, CSV), which the side panel shows in its text view. Unset for a link.
   */
  readonly kind?: "image" | "video" | "text"
  /** A text file's own name, for its Download button and to tell markdown. */
  readonly name?: string
}

const mediaKind = (attachment: Attachment): "image" | "video" | undefined => {
  if (attachment.kind === "image" || attachment.kind === "video") return attachment.kind
  if (attachment.mime?.startsWith("image/")) return "image"
  if (attachment.mime?.startsWith("video/")) return "video"
  return undefined
}

/** Null for a link without a URL. */
export const evidenceTarget = (attachment: Attachment): EvidenceTarget | null => {
  if (attachment.kind === "link") {
    return attachment.url ? { url: attachment.url, title: attachment.caption || shortUrl(attachment.url) } : null
  }
  const kind = mediaKind(attachment)
  const title = attachment.caption || attachment.name
  return kind ? { url: attachmentUrl(attachment), title, kind } : { url: attachmentUrl(attachment), title, kind: "text", name: attachment.name }
}

/** A screenshot as the image modal shows it: the served file, titled by its caption, and its file name. */
export interface EvidenceImage {
  readonly url: string
  readonly title: string
  readonly name: string
}

/**
 * Where a click on a piece of evidence opens it. A screenshot (any image, attached as a file too) opens
 * in the image modal over the page, at its place among the packet's images, so ←/→ step through them;
 * that's the same in the desktop app. A video or a text file opens in the side panel beside the board; a
 * link where viewer.ts's `openRoute` sends it. Null for a link without a URL.
 */
export type EvidenceOpen =
  | { readonly in: "modal"; readonly images: ReadonlyArray<EvidenceImage>; readonly index: number }
  | { readonly in: "panel"; readonly target: EvidenceTarget }

export const evidenceOpen = (attachment: Attachment, packet: ReadonlyArray<Attachment>): EvidenceOpen | null => {
  if (attachment.kind !== "link" && mediaKind(attachment) === "image") {
    const pieces = packet.some((a) => a.id === attachment.id) ? packet : [...packet, attachment]
    const images = evidenceInOrder(pieces).filter((a) => a.kind !== "link" && mediaKind(a) === "image")
    return {
      in: "modal",
      index: images.findIndex((a) => a.id === attachment.id),
      images: images.map((a) => ({ url: attachmentUrl(a), title: a.caption || a.name, name: a.name })),
    }
  }
  const target = evidenceTarget(attachment)
  return target ? { in: "panel", target } : null
}

/** A task's reviews (from `review.list`) kept current from the event stream. */
export const applyReviewEvents = (
  reviews: ReadonlyArray<Review>,
  taskId: string,
  events: ReadonlyArray<CelloEvent>,
): ReadonlyArray<Review> => {
  let next = reviews
  for (const e of events) {
    if (e.type === "review.submitted" && e.review.taskId === taskId && !next.some((r) => r.id === e.review.id)) {
      next = [...next, e.review]
    } else if (e.type === "review.decided" && e.taskId === taskId) {
      next = next.map((r) => (r.id === e.id ? { ...r, decision: e.decision, decisionNote: e.note, decidedAt: e.ts, ...(e.relayedBy ? { relayedBy: e.relayedBy } : {}) } : r))
    } else if (e.type === "review.withdrawn" && e.taskId === taskId) {
      next = next.map((r) => (r.id === e.id ? { ...r, decision: "withdrawn", decisionNote: null, decidedAt: e.ts } : r))
    }
  }
  return next
}
