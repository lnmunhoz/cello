import { describe, expect, it } from "vitest"
import { testWaitsFromEnv } from "./WakeConfig.ts"

describe("testWaitsFromEnv (CEL-92)", () => {
  it("shortens the waits only for an e2e server (CELLO_E2E=1): a production server keeps the 30 s and 2 min", () => {
    expect(testWaitsFromEnv({ CELLO_WAKE_BATCH_MS: "0", CELLO_WAKE_QUIET_MS: "0" })).toEqual({})
    expect(testWaitsFromEnv({ CELLO_E2E: "1", CELLO_WAKE_BATCH_MS: "3000", CELLO_WAKE_QUIET_MS: "0" })).toEqual({ batch: 3000, quiet: 0 })
    expect(testWaitsFromEnv({ CELLO_E2E: "1", CELLO_WAKE_BATCH_MS: "soon" })).toEqual({})
  })
})
