import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devbridgePlugin } from "@devbridge/vite-plugin";

/**
 * Example app — development instrumentation is ON here on purpose.
 *
 * `devbridgePlugin()` injects `data-dev-id` attributes into JSX host
 * elements and reports the identity map to the local agent, which is what
 * hover highlighting and element selection read. The plugin itself only
 * activates in `vite serve` (dev) mode — `vite build` output carries no
 * DevBridge metadata unless `enabled: true` is passed explicitly, so
 * production bundles stay clean. Do not copy this plugin line into every
 * consumer project automatically; instrumentation is an explicit opt-in.
 */
export default defineConfig({
  plugins: [devbridgePlugin(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
