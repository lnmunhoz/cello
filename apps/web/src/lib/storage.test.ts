import { afterEach, describe, expect, it } from "vitest"
import { readStored, subscribeStored, writeStored } from "./storage.ts"

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
const useStorage = (storage: unknown) => Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})

describe("readStored and writeStored: this device's saved settings, never an error", () => {
  it("reads back what was written", () => {
    const items = new Map<string, string>()
    useStorage({ getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) })
    expect(readStored("cello:x")).toBeNull()
    writeStored("cello:x", "1")
    expect(readStored("cello:x")).toBe("1")
  })

  it("null and a silent no-op when storage is missing or throws (private windows, blocked site data)", () => {
    useStorage(undefined)
    expect(readStored("cello:x")).toBeNull()
    expect(() => writeStored("cello:x", "1")).not.toThrow()
    useStorage({
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    })
    expect(readStored("cello:x")).toBeNull()
    expect(() => writeStored("cello:x", "1")).not.toThrow()
  })
})

describe("subscribeStored: screens showing a saved setting hear when it's written", () => {
  it("calls a key's listeners on a write to that key only, until they unsubscribe", () => {
    const items = new Map<string, string>()
    useStorage({ getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) })
    const heard: string[] = []
    const stop = subscribeStored("cello:a", () => heard.push(readStored("cello:a") ?? ""))
    writeStored("cello:a", "1")
    writeStored("cello:b", "2")
    stop()
    writeStored("cello:a", "3")
    expect(heard).toEqual(["1"])
  })
})
