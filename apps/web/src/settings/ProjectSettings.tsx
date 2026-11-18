// A project's Settings tab (CEL-164), after Activity: its labels, testing profile, waking agents and merge
// setting. The main Settings keeps what isn't per project.
import { projectByKey } from "@cello/client/sync/selectors"
import { useParams } from "@tanstack/react-router"
import { Centered } from "../app/Home.tsx"
import { NotFound } from "../app/NotFound.tsx"
import { useBoard } from "../lib/hooks.ts"
import { ProjectLabels } from "./Labels.tsx"
import { MergeSettings } from "./MergeSettings.tsx"
import { Section, SettingsColumn } from "./Section.tsx"
import { TestingProfile } from "./TestingProfile.tsx"
import { WakeSettings } from "./WakeSettings.tsx"

export function ProjectSettings() {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  if (!board) return <Centered>Loading…</Centered>
  const project = projectByKey(board, projectKey)
  if (!project) return <NotFound title={`No project with the key ${projectKey.toUpperCase()}`} />
  return (
    // Keyed on the project, so a draft (a half-typed label, a profile field) never carries to another project's page.
    <SettingsColumn key={project.key}>
      <Section title="Labels" description="This project's labels: its kinds, areas and milestones.">
        <ProjectLabels project={project} />
      </Section>
      <Section
        title="Testing"
        description="How agents test this project and collect evidence for review. cello init drafts it from the repo and agents fix it when the repo changes; what you set here, agents can't change."
      >
        <TestingProfile projectKey={project.key} />
      </Section>
      <Section
        title="Waking agents"
        description="Whether Cello starts this project's agent sessions by itself when you act on a task they claimed and nothing of them is running."
      >
        <WakeSettings projectKey={project.key} />
      </Section>
      <Section title="Merging" description="When this project's agents merge their work: before you review it, or after you approve it.">
        <MergeSettings project={project} />
      </Section>
    </SettingsColumn>
  )
}
