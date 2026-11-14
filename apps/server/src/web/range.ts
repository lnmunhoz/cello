// HTTP Range requests (RFC 9110 §14), so a browser can seek in a video. One range only; several at
// once get the whole file, which the RFC allows.

export type Range =
  | { readonly _tag: "Whole" }
  | { readonly _tag: "Partial"; readonly start: number; readonly end: number }
  | { readonly _tag: "Unsatisfiable" }

const SINGLE = /^bytes=(\d*)-(\d*)$/

/** Which bytes of a `size`-byte file a Range header asks for; `end` is inclusive. */
export const parseRange = (header: string | undefined, size: number): Range => {
  const match = header === undefined ? null : SINGLE.exec(header.trim())
  if (!match || (match[1] === "" && match[2] === "")) return { _tag: "Whole" }
  const [, from, to] = match as unknown as [string, string, string]
  if (from === "") {
    const suffix = Number(to)
    if (suffix === 0 || size === 0) return { _tag: "Unsatisfiable" }
    return { _tag: "Partial", start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(from)
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1)
  if (start >= size || end < start) return { _tag: "Unsatisfiable" }
  return { _tag: "Partial", start, end }
}
