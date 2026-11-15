import { describe, expect, it } from "vitest"
import { closedImageModal, closeImageModal, imageModal, openImageModal, stepImage } from "./imageModal.ts"

const shots = [
  { url: "/attachments/s1", title: "The board" },
  { url: "/attachments/s2", title: "Dark mode" },
  { url: "/attachments/s3", title: "The packet" },
]

describe("the image modal's state", () => {
  it("opens at the image clicked, steps through the others without running off either end, and closes", () => {
    openImageModal(shots, 1, null)
    expect(imageModal()).toMatchObject({ index: 1 })
    stepImage(1)
    expect(imageModal()?.index).toBe(2)
    stepImage(1)
    expect(imageModal()?.index).toBe(2)
    stepImage(-1)
    stepImage(-1)
    stepImage(-1)
    expect(imageModal()?.index).toBe(0)
    closeImageModal()
    expect(imageModal()).toBeNull()
    // Stepping while closed does nothing.
    stepImage(1)
    expect(imageModal()).toBeNull()
  })

  it("what to do after closing (open the viewer) runs once the modal has finished closing, and only once", () => {
    const opened: string[] = []
    openImageModal(shots, 0, null)
    closeImageModal(() => opened.push("viewer"))
    expect(imageModal()).toBeNull()
    expect(opened).toEqual([])
    closedImageModal()
    closedImageModal()
    expect(opened).toEqual(["viewer"])
    // A plain close (Esc) leaves nothing to run.
    openImageModal(shots, 0, null)
    closeImageModal()
    closedImageModal()
    expect(opened).toEqual(["viewer"])
  })

  it("opening again before the last close finished drops what that close was going to do", () => {
    const opened: string[] = []
    openImageModal(shots, 0, null)
    closeImageModal(() => opened.push("viewer"))
    openImageModal(shots, 1, null)
    closedImageModal()
    expect(opened).toEqual([])
    expect(imageModal()?.index).toBe(1)
    closeImageModal()
  })

  it("steps through images and diagrams alike, in the order given", () => {
    const flow = { kind: "diagram" as const, source: "flowchart TD\n  A --> B", title: "Diagram: A" }
    openImageModal([shots[0]!, flow, shots[1]!], 0, null)
    stepImage(1)
    expect(imageModal()?.items[imageModal()!.index]).toEqual(flow)
    stepImage(1)
    expect(imageModal()?.items[imageModal()!.index]).toEqual(shots[1])
    closeImageModal()
  })

  it("an index outside the list opens the nearest image; an empty list doesn't open", () => {
    openImageModal(shots, 7, null)
    expect(imageModal()?.index).toBe(2)
    openImageModal(shots, -3, null)
    expect(imageModal()?.index).toBe(0)
    closeImageModal()
    openImageModal([], 0, null)
    expect(imageModal()).toBeNull()
  })
})
