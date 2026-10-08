import { defineConfig } from "vitest/config";

/**
 * One runner for the whole workspace, for the same reason the extension
 * vendored Monaco instead of pulling it from a CDN: the repo already standardizes
 * on Vite, and vitest reuses it. Node's built-in test runner cannot load these
 * packages (their `main` fields point at TypeScript source with extensionless
 * relative imports, which Node's ESM resolver rejects), and it has no
 * transformation step to bridge that gap.
 */
export default defineConfig({
  test: {
    include: ["{apps,packages,adapters,plugins}/*/src/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
});