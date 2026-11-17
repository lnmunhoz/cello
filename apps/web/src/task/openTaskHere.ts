// Opens a task from a click on its link (a key in markdown, a chip, a parent link, a card off the
// board), in the main window, where viewer.ts's `taskOpenFrom` says (CEL-141): docked beside its own
// project's board or list, beside the milestone page you're on, or else in the side panel of the page
// you're on (`?viewer=/THAI/96`), which stays where it was.
import { taskPath } from "@cello/shared/taskKey"
import type { RegisteredRouter } from "@tanstack/react-router"
import { openInPanel } from "../lib/desktop.ts"
import { taskOpenFrom } from "../viewer/viewer.ts"

export const openTaskHere = (router: RegisteredRouter, task: { readonly projectKey: string; readonly number: number }): void => {
  const { projectKey } = task
  const number = String(task.number)
  const at = taskOpenFrom(router.state.location.pathname, task)
  switch (at.type) {
    case "board":
      void router.navigate({ to: "/$projectKey/$number", params: { projectKey, number } })
      return
    case "milestone":
      void router.navigate({ to: "/$projectKey/milestones/$milestoneId/$number", params: { projectKey, milestoneId: at.milestoneId, number } })
      return
    case "panel":
      openInPanel({ url: taskPath(projectKey, task.number) })
  }
}
