import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Simplified vite config for the example app.
 *
 * The full devbridgePlugin() (which runs the Babel transform to inject
 * data-dev-id attributes) requires the workspace TypeScript packages to be
 * compiled first. For local development / testing the panel we skip that
 * step and just run a plain React app — the content script will still find
 * data-dev-id attributes because CheckoutButton sets them manually via a ref.
 *
 * To enable the full Babel transform:
 *   1. Run `pnpm build` from the monorepo root (compiles all packages)
 *   2. Re-add: import { devbridgePlugin } from "@devbridge/vite-plugin"
 *   3. Add devbridgePlugin() to the plugins array below
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Fail loudly instead of silently drifting to 5174/5175 — the content
    // script's host permissions and the README both assume exactly 5173.
    strictPort: true,
  },
});
