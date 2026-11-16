import type { Product } from "./products.ts"

export type Line = { product: Product; quantity: number }

export function cartTotal(lines: Line[]): number {
  let total = 0
  for (const line of lines) total += line.product.price * line.quantity
  return Math.floor(total * 100) / 100
}
