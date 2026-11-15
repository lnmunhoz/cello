import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "e2e/**", "spikes/**"],
  },
})
