import { projectByKey } from "@cello/client/sync/selectors"
import { useCanGoBack, useLocation, useParams, useRouter } from "@tanstack/react-router"
import { ArrowLeftIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button, LinkButton } from "../components/ui/Button.tsx"
import { useBoard } from "../lib/hooks.ts"
import { Centered } from "./Home.tsx"

/** An address no route matches: `/CEL/pages/a/b`, `/CEL/demo.mp4`. Inside a project, its board is the way out. */
export function RouteNotFound() {
  const { projectKey } = useParams({ strict: false }) as { projectKey?: string }
  const board = useBoard()
  const project = board && projectKey ? projectByKey(board, projectKey) : undefined
  const { pathname } = useLocation()
  return <NotFound title="Nothing here" detail={<>Cello has no page at <code className="text-ink">{pathname}</code>.</>} projectKey={project?.key} />
}

/**
 * Every "there's nothing here" screen (an unknown address, page, task or project) has a way out, so
 * no click strands you (CEL-54): Back, when there's somewhere to go back to, and the project's board,
 * or Home when there's no project to go to.
 */
export function NotFound({ title, detail, projectKey }: { title: ReactNode; detail?: ReactNode; projectKey?: string | undefined }) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <Centered>
      <div role="status" className="flex max-w-md flex-col items-center gap-1 px-6 text-center">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        {detail ? <p>{detail}</p> : null}
        <div className="mt-3 flex items-center gap-2">
          {canGoBack ? (
            <Button variant="secondary" onClick={() => router.history.back()}>
              <ArrowLeftIcon aria-hidden className="size-3.5" />
              Back
            </Button>
          ) : null}
          {projectKey ? (
            <LinkButton to="/$projectKey/issues" params={{ projectKey }} variant={canGoBack ? "ghost" : "secondary"}>
              Go to the {projectKey} board
            </LinkButton>
          ) : (
            <LinkButton to="/" variant={canGoBack ? "ghost" : "secondary"}>
              Go home
            </LinkButton>
          )}
        </div>
      </div>
    </Centered>
  )
}
