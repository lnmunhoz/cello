import { expect, test } from "bun:test"
import { cartTotal } from "./cart.ts"
import { products } from "./products.ts"

test("one cap", () => {
  expect(cartTotal([{ product: products[2]!, quantity: 1 }])).toBe(17.35)
})

test("two mugs", () => {
  expect(cartTotal([{ product: products[1]!, quantity: 2 }])).toBe(25)
})
