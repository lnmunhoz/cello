// CEL-186 evidence only: a walk of the Agents page while three agents work, for before-and-after videos
// (the same walk runs on the base commit, where rows still re-sort on every call). It asserts nothing
// about order, so it runs on both; the behaviour is tested in agents-page.spec.ts. Skipped unless
// CELLO_E2E_WALK=1, so the suite never runs it.
import { agentAs, animationsSettled, caption, defaultWorkspace, expect, newCommandId, seedProject, test } from "./fixtures.ts"

test.skip(process.env["CELLO_E2E_WALK"] !== "1", "evidence walk: CELLO_E2E_WALK=1 runs it")

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (localStorage.getItem("cello:agent-cursors") === null) localStorage.setItem("cello:agent-cursors", "off")
  })
})

for (const theme of ["light", "dark"] as const) {
  test(`CEL-186 walk (${theme}): four agents work on the Agents page`, async ({ page, cello, baseURL }) => {
    test.setTimeout(180_000)
    const key = theme === "light" ? "WKL" : "WKD"
    const project = await seedProject(cello, `Walk ${theme}`, key)
    const { statuses } = await defaultWorkspace(cello)
    const titles = ["Make the timer louder", "Add a dark icon", "Sync the presets", "Count the laps"]
    for (const title of titles) await cello.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId: statuses.Todo!.id }))
    const agents = []
    for (const [i] of titles.entries()) {
      const agent = await agentAs(baseURL!, `c186${theme}${i}-walk-session`, process.pid)
      await agent.run((c) => c["task.claim"]({ commandId: newCommandId(), key: `${key}-${i + 1}` }))
      agents.push(agent)
    }
    const start = Date.now()
    await page.clock.setFixedTime(start)
    await page.goto("/agents")
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark")
    await expect(page.locator("[data-agent-row]").first()).toBeVisible()
    await caption(page, "Four agents working, listed in the order they started")

    const stages = ["building", "review", "fixing", "building"] as const
    // A wait that hands an agent a comment is a check-in the board hears at once (calls are heard once a minute).
    const snapshot = await cello.run((c) => c["snapshot.get"]({}))
    for (const [n, i] of [3, 1, 2, 0, 3].entries()) {
      await caption(page, `Agent ${i + 1} checks in (${stages[n % stages.length]})`)
      await agents[i]!.run((c) => c["task.stage"]({ commandId: newCommandId(), key: `${key}-${i + 1}`, stage: stages[n % stages.length]! }))
      const wait = agents[i]!.run((c) => c["inbox.wait"]({}))
      const task = snapshot.tasks.find((t) => t.key === `${key}-${i + 1}`)!
      await cello.run((c) => c["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: `Note ${n + 1}` }))
      await wait
      await animationsSettled(page)
    }

    await caption(page, "Agent 2 lets its task go: its row leaves")
    await agents[1]!.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-2` }))
    await animationsSettled(page)

    await caption(page, "Six minutes on, the others go quiet")
    await page.clock.setFixedTime(start + 6 * 60_000)
    await expect(page.locator('section[data-agents-group="quiet"]')).toBeVisible()
    await animationsSettled(page)
    await caption(page, "Agent 3 makes a call: it is working again")
    await agents[2]!.run((c) => c["task.stage"]({ commandId: newCommandId(), key: `${key}-3`, stage: "building" }))
    await page.clock.setFixedTime(Date.now())
    await animationsSettled(page)
    await caption(page, "The page is idle")

    for (const i of [0, 2, 3]) await agents[i]!.run((c) => c["task.release"]({ commandId: newCommandId(), key: `${key}-${i + 1}` }))
  })
}
