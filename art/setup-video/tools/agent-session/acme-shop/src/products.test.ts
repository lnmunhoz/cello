import { expect, test } from "bun:test"
import { searchProducts } from "./products.ts"

test("finds by name", () => {
  expect(searchProducts("mug").map((p) => p.sku)).toEqual(["MUG-002"])
})
