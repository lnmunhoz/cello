// Opens a task from a click on its link (a key in markdown, a chip, a parent link, a card off the
// board) or a pick in ⌘K (CEL-144), in the main window, where viewer.ts's `taskOpenFrom` says (CEL-141):
// docked beside its own project's board or list, beside the milestone page you're on, or else in the
// side panel of the page you're on (`?viewer=/THAI/96`), which stays where it was. `comment`: opened
// scrolled to that comment, which flashes once, wherever the task opens.
import type { RegisteredRouter } from "@tanstack/react-router"
import { openInPanel } from "../lib/desktop.ts"
import { taskOpenFrom, taskViewerPath } from "../viewer/viewer.ts"

export const openTaskHere = (
  router: RegisteredRouter,
  task: { readonly projectKey: string; readonly number: number },
  options?: { readonly comment?: string | undefined },
): void => {
  const { projectKey } = task
  const number = String(task.number)
  const comment = options?.comment
  const at = comment ? { search: { comment } } : {}
  const to = taskOpenFrom(router.state.location.pathname, task)
  switch (to.type) {
    case "board":
      void router.navigate({ to: "/$projectKey/$number", params: { projectKey, number }, ...at })
      return
    case "milestone":
      void router.navigate({ to: "/$projectKey/milestones/$milestoneId/$number", params: { projectKey, milestoneId: to.milestoneId, number }, ...at })
      return
    case "panel":
      openInPanel({ url: taskViewerPath(task, comment) })
  }
}
