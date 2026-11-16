export type Product = { sku: string; name: string; price: number }

export const products: Product[] = [
  { sku: "TEE-001", name: "Logo T-shirt", price: 19.99 },
  { sku: "MUG-002", name: "Coffee mug", price: 12.5 },
  { sku: "CAP-003", name: "Baseball cap", price: 17.35 },
  { sku: "BAG-004", name: "Tote bag", price: 9.95 },
]

export function searchProducts(query: string): Product[] {
  const q = query.toLowerCase()
  return products.filter((p) => p.name.toLowerCase().includes(q))
}
