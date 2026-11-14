// A stable color for an agent, picked from a palette by hashing a seed (its first session id).
export const AGENT_COLORS = ["#F97316", "#8B5CF6", "#10B981", "#EC4899", "#14B8A6", "#EAB308", "#6366F1", "#EF4444"] as const

export const colorFromSeed = (seed: string): string => {
  let hash = 2166136261 // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return AGENT_COLORS[(hash >>> 0) % AGENT_COLORS.length]!
}
