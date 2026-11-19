import { describe, expect, it } from "vitest"
import { celloOpenLink, celloScheme, celloTaskLink, linkFlavor, parseCelloLink } from "./celloLink.ts"

const PAGE = "http://127.0.0.1:4747/FE/pages/saved-library-design"

describe("celloScheme: each flavor of Cello has its own scheme, so the two apps never take each other's links (CEL-149)", () => {
  it("is cello for the release (the download), cello-dev for Cello Dev (built on the Mac)", () => {
    expect(celloScheme("release")).toBe("cello")
    expect(celloScheme("dev")).toBe("cello-dev")
  })
})

describe("celloOpenLink: the link an agent puts in a reply, so a click opens Cello's panel (CEL-88)", () => {
  it("wraps the page's address, encoded, in cello://open?url=", () => {
    expect(celloOpenLink(PAGE, "release")).toBe("cello://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FFE%2Fpages%2Fsaved-library-design")
  })

  it("is cello-dev://open?url= from a dev build", () => {
    expect(celloOpenLink(PAGE, "dev")).toBe("cello-dev://open?url=http%3A%2F%2F127.0.0.1%3A4747%2FFE%2Fpages%2Fsaved-library-design")
  })

  it("keeps a query and a section in the address it carries", () => {
    const section = "http://127.0.0.1:4747/CEL/pages/notes?version=2#next-steps"
    expect(parseCelloLink(celloOpenLink(section, "release"))).toEqual({ kind: "open", url: section })
  })
})

describe("celloTaskLink", () => {
  it("is cello://<KEY>, with the key in capitals", () => {
    expect(celloTaskLink("CEL-12", "release")).toBe("cello://CEL-12")
    expect(celloTaskLink("cel-12", "release")).toBe("cello://CEL-12")
  })

  it("is cello-dev://<KEY> from a dev build", () => {
    expect(celloTaskLink("cel-12", "dev")).toBe("cello-dev://CEL-12")
  })
})

describe("parseCelloLink: what a cello:// link asks for", () => {
  it("reads back what the builders make, in either flavor", () => {
    for (const flavor of ["release", "dev"] as const) {
      expect(parseCelloLink(celloOpenLink(PAGE, flavor))).toEqual({ kind: "open", url: PAGE })
      expect(parseCelloLink(celloTaskLink("CEL-12", flavor))).toEqual({ kind: "task", projectKey: "CEL", number: 12 })
    }
  })

  it("tells which flavor's scheme a link has", () => {
    expect(linkFlavor("cello://CEL-3")).toBe("release")
    expect(linkFlavor("CELLO-DEV://open?url=x")).toBe("dev")
    expect(linkFlavor("https://claude.ai")).toBeNull()
    expect(linkFlavor("cello-devx://CEL-3")).toBeNull()
  })

  it("takes a task key as the host or the path, in any case", () => {
    expect(parseCelloLink("cello://thai-12/")).toEqual({ kind: "task", projectKey: "THAI", number: 12 })
    expect(parseCelloLink("CELLO:CEL-3")).toEqual({ kind: "task", projectKey: "CEL", number: 3 })
  })

  it("hands an open link's address over as it is: what may be opened is the opener's call", () => {
    expect(parseCelloLink(`cello://open?url=${encodeURIComponent("javascript:alert(1)")}`)).toEqual({ kind: "open", url: "javascript:alert(1)" })
  })

  it("refuses anything else", () => {
    for (const bad of ["cello://open", "cello://open?url=", "cello://CEL-0", "cello://not a key", "cello://", "https://claude.ai", "garbage"]) {
      expect(parseCelloLink(bad), bad).toBeNull()
    }
  })
})
