import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.ts", "e2e/**/*.test.ts"],
    exclude: ["**/node_modules/**", "spikes/**"],
    // `bun run test:coverage` (and the Docker `unit` step) turns it on. Istanbul instruments the code,
    // so it works under `bun --bun`, where V8's inspector coverage isn't there (CEL-201).
    coverage: {
      provider: "istanbul",
      include: ["packages/*/src/**/*.{ts,tsx}", "apps/*/src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "**/node_modules/**", "apps/*/e2e/**", "apps/cli/scripts/**"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
})
