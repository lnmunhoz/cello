import { describe, expect, it } from "vitest"
import { answerOf, parseQuitChoice, planQuit, QUIT_QUESTION, serverStatusLabel } from "./quit.ts"

describe("planQuit", () => {
  it("leaves a server the app joined alone: the background service, or a terminal's `cello start`", () => {
    expect(planQuit({ startedByUs: false, service: true, remembered: null })).toBe("leave")
    expect(planQuit({ startedByUs: false, service: false, remembered: "stop" })).toBe("leave")
  })

  it("asks once when the app started the server and no service is installed", () => {
    expect(planQuit({ startedByUs: true, service: false, remembered: null })).toBe("ask")
  })

  it("does what was answered before, without asking again", () => {
    expect(planQuit({ startedByUs: true, service: false, remembered: "keep" })).toBe("keep")
    expect(planQuit({ startedByUs: true, service: false, remembered: "stop" })).toBe("stop")
  })

  it("stops its own server, without asking, once a service is installed: the service takes over the data folder", () => {
    expect(planQuit({ startedByUs: true, service: true, remembered: "keep" })).toBe("stop")
  })
})

describe("the quit question", () => {
  it("offers Keep Running, Stop Server and Install Background Service, with Cancel to stay open", () => {
    expect(QUIT_QUESTION.message).toBe("Keep Cello running for your agents?")
    expect(QUIT_QUESTION.buttons).toEqual(["Keep Running", "Stop Server", "Install Background Service", "Cancel"])
    expect(QUIT_QUESTION.defaultId).toBe(0)
    expect(QUIT_QUESTION.cancelId).toBe(3)
    expect(QUIT_QUESTION.detail).toContain("cello service install")
  })

  it("maps each button to its answer", () => {
    expect([0, 1, 2, 3, 9].map(answerOf)).toEqual(["keep", "stop", "install", "cancel", "cancel"])
  })

  it("reads a remembered answer, and ignores anything else", () => {
    expect(parseQuitChoice(JSON.stringify({ onQuit: "keep" }))).toBe("keep")
    expect(parseQuitChoice(JSON.stringify({ onQuit: "stop" }))).toBe("stop")
    expect(parseQuitChoice(JSON.stringify({ onQuit: "install" }))).toBeNull()
    expect(parseQuitChoice("{oops")).toBeNull()
    expect(parseQuitChoice(null)).toBeNull()
  })
})

describe("serverStatusLabel", () => {
  it("names who runs the server the app uses, and its pid", () => {
    expect(serverStatusLabel({ startedByUs: false, service: true, pid: 44568 })).toBe("Server: background service (pid 44568)")
    expect(serverStatusLabel({ startedByUs: true, service: false, pid: 123 })).toBe("Server: started by this app (pid 123)")
    expect(serverStatusLabel({ startedByUs: false, service: false, pid: 77 })).toBe("Server: started outside the app (pid 77)")
    expect(serverStatusLabel({ startedByUs: false, service: false, pid: null })).toBe("Server: started outside the app")
    expect(serverStatusLabel(null)).toBe("Server: starting…")
  })
})
