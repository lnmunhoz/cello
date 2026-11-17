// Settings' Merging section (CEL-143): whether a project's agents merge before you review (Approve moves
// the task to Done) or after you approve (Approve tells the agent to merge; the task shows Approved ·
// merging until the agent's `cello task done`). On for new projects with a repository.
import type { Project } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { Switch } from "../components/ui/Switch.tsx"
import { commands } from "../lib/cello.ts"

export function MergeSettings({ project }: { project: Project }) {
  const update = useAtomSet(commands.updateProject)
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" data-merge-settings>
      <li className="px-3 py-2.5">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">Merge after I approve</span>
          <Switch
            checked={project.mergeAfterApproval}
            onCheckedChange={(mergeAfterApproval) => update({ id: project.id, mergeAfterApproval })}
          />
        </label>
        <p className="mt-1 text-[13px] text-muted">
          {project.mergeAfterApproval
            ? "Agents hand work in before they merge, with the PR when the project uses PRs. Approve and merge tells the agent to merge it now; the card shows Approved · merging until it's merged and moves to Done."
            : "Agents merge before they hand work in, so you review what's already merged. Approve moves the task to Done."}
        </p>
      </li>
    </ul>
  )
}
