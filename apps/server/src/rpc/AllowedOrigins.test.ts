import { describe, expect, it } from "vitest"
import { isAllowedRequest } from "./AllowedOrigins.ts"

describe("isAllowedRequest", () => {
  it("allows 127.0.0.1 and localhost on the server port and the Vite port", () => {
    expect(isAllowedRequest({ host: "127.0.0.1:4748" }, 4748)).toBe(true)
    expect(isAllowedRequest({ host: "localhost:4748", origin: "http://localhost:5199" }, 4748)).toBe(true)
    expect(isAllowedRequest({ host: "localhost:5199", origin: "http://127.0.0.1:5199" }, 4748)).toBe(true)
  })

  it("refuses other hosts, other origins, other ports and a missing Host", () => {
    expect(isAllowedRequest({ host: "evil.example:4748" }, 4748)).toBe(false)
    expect(isAllowedRequest({ host: "127.0.0.1:4748", origin: "http://evil.example" }, 4748)).toBe(false)
    expect(isAllowedRequest({ host: "127.0.0.1:4748", origin: "http://localhost:3000" }, 4748)).toBe(false)
    expect(isAllowedRequest({ host: "127.0.0.1:9999" }, 4748)).toBe(false)
    expect(isAllowedRequest({}, 4748)).toBe(false)
    expect(isAllowedRequest({ host: "127.0.0.1:4748", origin: "null" }, 4748)).toBe(false)
  })
})
