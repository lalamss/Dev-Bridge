import { createRoot } from "react-dom/client";
import { App } from "./App";

/**
 * Boot order:
 *   1. panel.html loads the vendored AMD loader (./vs/loader.js) as a classic
 *      script, so window.require already exists by the time this module runs.
 *   2. require.config points the AMD loader at our local dist/vs directory.
 *   3. require(["vs/editor/editor.main"]) resolves and sets window.monaco.
 *   4. We mount React only after Monaco is available so the editor can
 *      initialise synchronously the first time a source file loads.
 *
 * Everything is served from the extension package — no CDN. DevTools panel
 * pages inherit the extension CSP (MV3: script-src 'self'), so any remote
 * origin is refused before it executes.
 *
 * The Monaco CDN types are declared on the global type here so TypeScript
 * doesn't complain in App.tsx. `monaco-editor` is a real dependency now, so
 * this resolves against the installed package rather than an ambient module.
 */
declare global {
  interface Window {
    monaco: typeof import("monaco-editor");
    require: {
      (deps: string[], cb: () => void): void;
      config: (opts: object) => void;
    };
  }
}

/**
 * MV3 requires web workers to come from the extension package, and the CSP
 * forbids the blob:/data: workers Monaco falls back to by default. Pointing
 * getWorkerUrl at the vendored worker entry keeps completion, validation and
 * the language services working under the extension's CSP.
 *
 * `MonacoEnvironment` is declared on Window by monaco-editor's own type
 * definitions, so it is assigned through `window` rather than redeclared
 * here — a second declaration would conflict on type.
 */
window.MonacoEnvironment = {
  getWorkerUrl: () => chrome.runtime.getURL("vs/base/worker/workerMain.js"),
};

function boot() {
  const root = document.getElementById("root")!;
  createRoot(root).render(<App />);
}

// If the loader script hasn't run yet (shouldn't happen), fall back to
// mounting immediately — the Monaco hook in App.tsx will just show a spinner.
if (window.monaco) {
  boot();
} else if (window.require) {
  window.require.config({
    paths: { vs: chrome.runtime.getURL("vs") },
  });
  window.require(["vs/editor/editor.main"], boot);
} else {
  boot();
}
