// The task panel's "New milestone…" (CEL-113): what Create does with the name typed. A name an open
// milestone of the project already has puts the task in that one, so a retry after a half-done first try
// (the milestone made, the task not yet in it) finishes the job instead of failing on the taken name.
import type { Milestone } from "@cello/contract/entities"
import { findMilestone } from "@cello/shared/milestone"

export type NewMilestoneStep =
  | { readonly kind: "create"; readonly name: string }
  | { readonly kind: "assign"; readonly milestoneId: string }
  | { readonly kind: "problem"; readonly message: string }

export const newMilestoneStep = (
  milestones: ReadonlyArray<Milestone>,
  projectId: string,
  projectKey: string,
  typed: string,
): NewMilestoneStep => {
  const name = typed.trim()
  if (name === "") return { kind: "problem", message: "Give it a name" }
  const match = findMilestone(milestones.filter((m) => m.projectId === projectId), name, { projectKey, allowNone: false })
  if (!("found" in match) || match.found === null) return { kind: "create", name }
  if (match.found.state === "open") return { kind: "assign", milestoneId: match.found.id }
  return { kind: "problem", message: `${projectKey} already has a closed milestone named ${match.found.name}` }
}
