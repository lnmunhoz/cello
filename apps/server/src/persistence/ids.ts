// ULIDs as text: 48-bit time + 80 random bits, Crockford base32. Monotonic within one millisecond.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

let lastTime = -1
let lastRandom: number[] = []

const encodeTime = (time: number): string => {
  let out = ""
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[time % 32]! + out
    time = Math.floor(time / 32)
  }
  return out
}

const freshRandom = (): number[] => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b % 32)

const increment = (digits: number[]): number[] => {
  const next = [...digits]
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]! < 31) {
      next[i]! += 1
      return next
    }
    next[i] = 0
  }
  return next
}

export const newId = (now: number = Date.now()): string => {
  if (now <= lastTime) {
    lastRandom = increment(lastRandom)
  } else {
    lastTime = now
    lastRandom = freshRandom()
  }
  return encodeTime(lastTime) + lastRandom.map((d) => ALPHABET[d]).join("")
}
