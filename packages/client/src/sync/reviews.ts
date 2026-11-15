// Review packets on the client: the queue the Review page shows, where evidence is served, and a
// task's loaded review list kept current from the event stream.
import type { Attachment, Project, Review, Task } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { attachmentPath } from "@cello/shared/attachment"
import { shortUrl } from "@cello/shared/linkify"
import { isReviewStatus } from "@cello/shared/review"
import type { BoardState } from "./applyEvents.ts"

export interface ReviewItem {
  readonly task: Task
  readonly project: Project
  /** Null for a task moved to In Review by hand, without a packet. */
  readonly review: Review | null
}

/** A task's open review, if it has one. */
export const openReviewOf = (state: BoardState, taskId: string): Review | undefined =>
  Object.values(state.reviews).find((r) => r.taskId === taskId)

/**
 * Everything waiting on Lucas in a workspace: tasks with an open review (oldest packet first), then
 * tasks sitting in In Review without one. Archived tasks and projects are left out.
 */
export const reviewQueue = (state: BoardState, workspaceId: string): ReviewItem[] => {
  const projectOf = (task: Task) => {
    const project = state.projects[task.projectId]
    return project && project.workspaceId === workspaceId && project.archivedAt === null ? project : undefined
  }
  const withPacket: ReviewItem[] = []
  const reviewed = new Set<string>()
  for (const review of Object.values(state.reviews).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))) {
    const task = state.tasks[review.taskId]
    const project = task && task.archivedAt === null ? projectOf(task) : undefined
    if (!task || !project) continue
    reviewed.add(task.id)
    withPacket.push({ task, project, review })
  }
  const without = Object.values(state.tasks)
    .filter((t) => t.archivedAt === null && !reviewed.has(t.id) && isReviewStatus(state.statuses[t.statusId]?.name ?? ""))
    .sort((a, b) => a.updatedAt - b.updatedAt || a.number - b.number)
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
  /** Set when the file is an image or a video; anything else shows as a page. */
  readonly kind?: "image" | "video"
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
  return { url: attachmentUrl(attachment), title: attachment.caption || attachment.name, ...(kind ? { kind } : {}) }
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
      next = next.map((r) => (r.id === e.id ? { ...r, decision: e.decision, decisionNote: e.note, decidedAt: e.ts } : r))
    }
  }
  return next
}
