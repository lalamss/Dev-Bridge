import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background:       resolve(__dirname, "src/background.ts"),
        "content-script": resolve(__dirname, "src/content-script.ts"),
        devtools:         resolve(__dirname, "src/devtools.ts"),
        panel:            resolve(__dirname, "src/panel/index.tsx"),
      },
      output: {
        entryFileNames: "[name].js",
        format: "es",
      },
      external: ["monaco-editor"],
    },
  },
});
