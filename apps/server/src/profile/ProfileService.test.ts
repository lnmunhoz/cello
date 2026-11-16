// CEL-89: a project's testing profile. Each field records who set it (detected, an agent, the human)
// and when; every change is one `profile.changed` event in the same command; an agent can't change what
// the human set; `cello init`'s detection only fills fields that are empty or were detected before.
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services, TEST_HUMAN } from "../testing/TestLayers.ts"
import * as ProfileService from "./ProfileService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-builder", client: "Claude Code", pid: process.pid })

const setup = Effect.gen(function* () {
  const profiles = yield* ProfileService.ProfileService
  const { project } = yield* setupProject
  const ref = { key: project.key }
  const set = (fields: Record<string, string>, more: { unset?: string[]; detected?: boolean } = {}) =>
    profiles.set({ commandId: cmd(), project: ref, set: Object.entries(fields).map(([field, value]) => ({ field, value })), ...more })
  const values = Effect.map(profiles.get(ref), (p) => Object.fromEntries(p.fields.map((f) => [f.field, `${f.value} (${f.source})`])))
  const events = Effect.flatMap(EventStore.EventStore, (store) => store.history(project.id))
  return { profiles, project, ref, set, values, events }
})

describe("ProfileService", () => {
  it.effect("an empty profile to start; a set field records its value, source, caller and time, in display order", () =>
    run(Effect.gen(function* () {
      const { profiles, project, ref, set } = yield* setup
      expect(yield* profiles.get(ref)).toEqual({ projectId: project.id, fields: [] })
      yield* TestClock.adjust(5000)
      yield* set({ "e2e.web.run": "bun run test:e2e", "unit": "bun run test", "install": "bun install" })
      const { fields } = yield* profiles.get(ref)
      expect(fields.map((f) => f.field)).toEqual(["install", "unit", "e2e.web.run"])
      expect(fields[1]).toMatchObject({ value: "bun run test", source: "human", sessionId: null, updatedAt: 5000 })
      const agentSet = yield* agent(set({ typecheck: "bun run typecheck" }))
      expect(agentSet.result.profile.fields.find((f) => f.field === "typecheck")).toMatchObject({ source: "agent" })
      expect(agentSet.result.profile.fields.find((f) => f.field === "typecheck")!.sessionId).not.toBeNull()
    })))

  it.effect("every change is one profile.changed event with before and after; unchanged fields aren't in it", () =>
    run(Effect.gen(function* () {
      const { set, events } = yield* setup
      const first = yield* set({ unit: "bun run test", install: "bun install" })
      yield* set({ unit: "bun run test:unit" }, { unset: ["install", "typecheck"] })
      const changed = (yield* events).filter((e): e is Extract<CelloEvent, { type: "profile.changed" }> => e.type === "profile.changed")
      expect(changed).toHaveLength(2)
      expect(changed[0]!.seq).toBe(first.seq)
      expect(changed[1]!.changes.map((c) => [c.field, c.before?.value ?? null, c.after?.value ?? null])).toEqual([
        ["unit", "bun run test", "bun run test:unit"],
        ["install", "bun install", null],
      ])
      // Nothing to change: no event, no seq.
      expect((yield* set({}, { unset: ["typecheck"] })).seq).toBeNull()
    })))

  it.effect("an agent can't change or unset a field the human set: ProfileFieldLocked, and nothing in the command is written", () =>
    run(Effect.gen(function* () {
      const { set, values } = yield* setup
      yield* set({ unit: "bun run test" })
      const refused = yield* Effect.flip(agent(set({ install: "bun install", unit: "npm test" })))
      expect(refused).toMatchObject({ _tag: "ProfileFieldLocked", field: "unit", value: "bun run test", human: TEST_HUMAN })
      expect(yield* Effect.flip(agent(set({}, { unset: ["unit"] })))).toMatchObject({ _tag: "ProfileFieldLocked", field: "unit" })
      expect(yield* values).toEqual({ unit: "bun run test (human)" })
      // The same value isn't a change: it stays the human's.
      expect((yield* agent(set({ unit: "bun run test" }))).result).toMatchObject({ written: [], kept: ["unit"] })
      // The human overwrites anything, an agent's field included.
      yield* agent(set({ install: "bun i" }))
      yield* set({ install: "bun install" })
      expect(yield* values).toEqual({ unit: "bun run test (human)", install: "bun install (human)" })
    })))

  it.effect("detected values fill empty and detected fields only; agent and human fields are kept; setting the same value confirms it", () =>
    run(Effect.gen(function* () {
      const { set, values, profiles, ref } = yield* setup
      yield* agent(set({ install: "bun i" }))
      yield* set({ unit: "bun run test" })
      const detected = yield* agent(set({ install: "bun install", unit: "vitest run", typecheck: "tsc" }, { detected: true }))
      expect(detected.result).toMatchObject({ written: ["typecheck"], kept: ["install", "unit"] })
      expect(yield* values).toEqual({ install: "bun i (agent)", unit: "bun run test (human)", typecheck: "tsc (detected)" })
      yield* TestClock.adjust(60_000)
      const again = yield* set({ typecheck: "tsc" }, { detected: true })
      expect(again.result.written).toEqual(["typecheck"])
      expect((yield* profiles.get(ref)).fields.find((f) => f.field === "typecheck")).toMatchObject({ source: "detected", updatedAt: 60_000 })
      // Detection never unsets.
      expect(yield* Effect.flip(set({}, { unset: ["typecheck"], detected: true }))).toMatchObject({ _tag: "Invalid", field: "unset" })
    })))

  it.effect("refuses unknown fields and bad values, naming the field", () =>
    run(Effect.gen(function* () {
      const { set } = yield* setup
      expect(yield* Effect.flip(set({ deploy: "x" }))).toMatchObject({ _tag: "Invalid", field: "deploy" })
      expect(yield* Effect.flip(set({ "ui.runsIn": "vm" }))).toMatchObject({ _tag: "Invalid", field: "ui.runsIn" })
      expect(yield* Effect.flip(set({ unit: " " }))).toMatchObject({ _tag: "Invalid", field: "unit" })
      expect(yield* Effect.flip(set({}, { unset: ["nope"] }))).toMatchObject({ _tag: "Invalid", field: "nope" })
    })))
})
