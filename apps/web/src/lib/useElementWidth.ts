import { useLayoutEffect, useState } from "react"

/**
 * An element's width in px, kept current as it resizes: pass the returned ref callback to the element.
 * 0 until the element is there. The browser tells when the size changes, so nothing polls.
 */
export function useElementWidth(): readonly [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, width]
}
