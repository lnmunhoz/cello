// Waking sessions in service tests (CEL-92): every service, plus the session host and WakeService over a
// fake agent driver, run logs in a temp folder, and a process check the test controls.
import * as path from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AgentDriver from "../wake/agents/AgentDriver.ts"
import * as SessionHost from "../wake/SessionHost.ts"
import * as WakeConfig from "../wake/WakeConfig.ts"
import * as WakeService from "../wake/WakeService.ts"
import type { FakeAgent } from "./fakeAgent.ts"
import { services } from "./TestLayers.ts"
import { tempDataDir } from "./tempDir.ts"

export interface WakeWorld {
  /** Pids the process check says are running; every other pid has exited. */
  readonly alive: Set<number>
  /** The environment runs get and the settings read (ANTHROPIC_API_KEY…). */
  env: Record<string, string>
  /** The temp `runs` folder. */
  runsDir: string
}

export const wakeWorld = (): WakeWorld => ({ alive: new Set(), env: { PATH: "/usr/bin:/bin" }, runsDir: "" })

/** The host and WakeService (without its watch) over `services()`, the fake's driver and `world`. */
export const wakeServices = (fake: FakeAgent, world: WakeWorld) =>
  WakeService.layer.pipe(
    Layer.provideMerge(SessionHost.layer),
    Layer.provideMerge(AgentDriver.layer([fake.driver])),
    Layer.provideMerge(Layer.unwrap(Effect.map(tempDataDir, (dir) => {
      world.runsDir = path.join(dir, WakeConfig.RUNS_DIR)
      return WakeConfig.layer({
        runsDir: world.runsDir,
        env: Effect.sync(() => world.env),
        isAlive: (pid) => world.alive.has(pid),
      })
    }))),
    Layer.provideMerge(services()),
  )
