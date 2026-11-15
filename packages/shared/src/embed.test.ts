import { describe, expect, it } from "vitest"
import { embedUrl } from "./embed.ts"

const ORIGIN = "http://localhost:4747"

describe("embedUrl: Cello pages in a panel show without the sidebar", () => {
  it("adds embed=1 to the board's own pages, keeping their search and hash", () => {
    expect(embedUrl("http://localhost:4747/CEL/pages/notes", ORIGIN)).toBe("http://localhost:4747/CEL/pages/notes?embed=1")
    expect(embedUrl("http://localhost:4747/CEL/issues?layout=list#x", ORIGIN)).toBe("http://localhost:4747/CEL/issues?layout=list&embed=1#x")
    expect(embedUrl("http://localhost:4747/CEL/pages/notes?embed=1", ORIGIN)).toBe("http://localhost:4747/CEL/pages/notes?embed=1")
  })

  it("leaves served files and other sites alone", () => {
    expect(embedUrl("http://localhost:4747/attachments/f1", ORIGIN)).toBe("http://localhost:4747/attachments/f1")
    expect(embedUrl("https://example.com/", ORIGIN)).toBe("https://example.com/")
  })
})
