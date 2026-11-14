// A tiny class-variance helper: each primitive declares its looks once, callers pick by name.
type Config = Record<string, Record<string, string>>
type Picks<V extends Config> = { [K in keyof V]?: keyof V[K] }

export const variants =
  <V extends Config>(base: string, config: V, defaults: { [K in keyof V]: keyof V[K] }) =>
  (picks: Picks<V> = {}): string =>
    [base, ...Object.keys(config).map((k) => config[k]![(picks[k] ?? defaults[k]) as string])].join(" ")

export type VariantProps<F> = F extends (picks?: infer P) => string ? NonNullable<P> : never
