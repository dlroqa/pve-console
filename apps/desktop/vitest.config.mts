import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    root: resolve(import.meta.dirname),
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
    },
  },
});
