// The zoomable things on a page or in a packet: images, screenshots and diagrams. Each one's button
// carries what it opens as data attributes (`zoomable`), and its gallery is everything zoomable inside
// the nearest `[data-gallery]` around it (a page, a packet), in document order, so ← and → in the
// image modal step through them as they read.
import { openImageModal, type ModalItem } from "./imageModal.ts"

type Dataset = Readonly<Record<string, string | undefined>>

/** The data attributes that make an element open `item` in the image modal, with the rest of its gallery. */
export const zoomable = (item: ModalItem): Record<`data-${string}`, string> =>
  item.kind === "diagram"
    ? { "data-zoomable": "diagram", "data-title": item.title, "data-source": item.source }
    : { "data-zoomable": "image", "data-url": item.url, "data-title": item.title, ...(item.name ? { "data-name": item.name } : {}) }

/** What an element opens, read back from its dataset; null when it isn't zoomable or lacks what it opens. */
export const zoomableItem = ({ zoomable, url, title = "", name, source }: Dataset): ModalItem | null => {
  if (zoomable === "image" && url) return { url, title, ...(name ? { name } : {}) }
  if (zoomable === "diagram" && source) return { kind: "diagram", source, title }
  return null
}

/** The items of a gallery's elements (their datasets, in document order), and where the clicked one landed. */
export const galleryOf = (entries: ReadonlyArray<Dataset>, clicked: number): { items: ModalItem[]; index: number } => {
  const items: ModalItem[] = []
  let index = 0
  entries.forEach((entry, i) => {
    const item = zoomableItem(entry)
    if (!item) return
    if (i === clicked) index = items.length
    items.push(item)
  })
  return { items, index }
}

/** Opens `element` (a zoomable button) in the image modal, with its gallery; it gets the focus back on close. */
export const openGallery = (element: HTMLElement): void => {
  if (!zoomableItem(element.dataset)) return
  const scope = element.closest<HTMLElement>("[data-gallery]")
  const elements = scope ? [...scope.querySelectorAll<HTMLElement>("[data-zoomable]")] : [element]
  const { items, index } = galleryOf(
    elements.map((e) => e.dataset),
    elements.indexOf(element),
  )
  openImageModal(items, index, element)
}
