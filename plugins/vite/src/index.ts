import type { Plugin } from "vite";
import { ReactAdapter } from "@devbridge/adapter-react";
import type { DevIdentity } from "@devbridge/protocol";

export interface DevBridgeViteOptions {
  /** Local agent HTTP base URL. Default matches apps/local-agent's default port. */
  agentUrl?: string;
  /** Only run in development — never ship data-dev-id attrs to production. */
  enabled?: boolean;
  /** File extensions to scan for JSX. */
  include?: RegExp;
}

const DEFAULT_INCLUDE = /\.[jt]sx?$/;

/**
 * devbridgePlugin() — Vite integration (architecture doc section 4).
 *
 * Pipeline: Developer source -> framework compiler -> [this plugin] ->
 * AST analysis -> browser bundle. On every transform of a JSX/TSX file it:
 *   1. Runs the React adapter's Babel transform to inject data-dev-id
 *      attributes and collect DevIdentity records.
 *   2. POSTs the collected identities to the local agent so the registry
 *      stays in sync with HMR (architecture doc section 53-54).
 *
 * Only active in serve (dev) mode — production builds never get instrumented
 * unless explicitly opted into (`enabled: true` in a build config).
 */
export function devbridgePlugin(options: DevBridgeViteOptions = {}): Plugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const agentUrl = options.agentUrl ?? "http://localhost:4577";
  const adapter = new ReactAdapter();
  let isDev = false;

  async function pushIdentities(identities: DevIdentity[]) {
    if (identities.length === 0) return;
    try {
      await fetch(`${agentUrl}/identity/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identities }),
      });
    } catch {
      // Local agent may not be running yet (e.g. `vite dev` started before
      // `devbridge start`) — this is non-fatal, the app must still render.
    }
  }

  return {
    name: "devbridge:vite-plugin",
    enforce: "pre",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    transform(code, id) {
      if (!isDev && !options.enabled) return null;
      if (!include.test(id)) return null;
      if (id.includes("node_modules")) return null;

      const { code: transformed, map, identities } = adapter.transformSource({ file: id, code });
      if (identities.length > 0) void pushIdentities(identities);

      return { code: transformed, map: map as any };
    },

    // Injects the runtime bridge (adapter-react/runtimeHook) so every dev
    // build auto-connects to the local agent's WebSocket without the app
    // author having to add imports manually.
    transformIndexHtml() {
      if (!isDev) return [];
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: `import { connectRuntimeBridge } from "@devbridge/adapter-react"; connectRuntimeBridge();`,
          injectTo: "head",
        },
      ];
    },
  };
}

export default devbridgePlugin;
