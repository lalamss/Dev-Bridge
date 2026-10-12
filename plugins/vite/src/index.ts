import { relative, resolve, sep } from "node:path";
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
  let projectRoot = process.cwd();
  let rootCheckDone = false;

  /**
   * Reliable registration (Settings status fix).
   *
   * The agent keeps the identity registry and the dev-server URL in memory,
   * and pushes used to be fire-and-forget at transform time only. That meant:
   * the agent being down (or restarted) at the wrong moment left the panel
   * reporting "not reported / zero registered" even though the DOM was fully
   * instrumented — and a page reload served from Vite's transform cache never
   * re-pushed. So this plugin now:
   *   - accumulates every transformed identity in a bounded map keyed by id
   *     (re-transforms overwrite the same id: no duplicates by construction);
   *   - flushes the whole pending set on every transform AND on a 15s timer,
   *     keeping unacknowledged items until a flush succeeds;
   *   - re-reports the dev-server URL with every flush until the agent acks
   *     it, then keeps re-reporting on the timer so an agent restart heals
   *     without requiring file edits;
   *   - chunks bulk posts to the agent's batch cap and never overlaps two
   *     flushes (a transform during a flush just queues the next one).
   * All network work stays best-effort and non-fatal: the app must render
   * whether or not the agent is reachable.
   */
  const MAX_PENDING_IDENTITIES = 5000;
  const BULK_CHUNK_SIZE = 2000;
  const RECONCILE_INTERVAL_MS = 15000;
  const pendingIdentities = new Map<string, DevIdentity>();
  let devServerUrl: string | null = null;
  let devServerAcked = false;
  let flushInFlight = false;
  let flushQueued = false;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;

  function rememberIdentities(identities: DevIdentity[]): void {
    for (const identity of identities) {
      if (!pendingIdentities.has(identity.id) && pendingIdentities.size >= MAX_PENDING_IDENTITIES) {
        // Bounded memory: drop the oldest entry to make room.
        const oldest = pendingIdentities.keys().next();
        if (!oldest.done) pendingIdentities.delete(oldest.value);
      }
      pendingIdentities.set(identity.id, identity);
    }
  }

  async function postJson(path: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${agentUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function flushRegistration(): Promise<void> {
    if (flushInFlight) {
      flushQueued = true;
      return;
    }
    flushInFlight = true;
    try {
      // Identities first, in agent-accepted chunks; a failed chunk stays
      // pending for the next flush instead of being dropped.
      const queued = [...pendingIdentities.values()];
      for (let i = 0; i < queued.length; i += BULK_CHUNK_SIZE) {
        const chunk = queued.slice(i, i + BULK_CHUNK_SIZE);
        const ok = await postJson("/identity/bulk", { identities: chunk });
        if (!ok) return;
        for (const identity of chunk) {
          if (pendingIdentities.get(identity.id) === identity) pendingIdentities.delete(identity.id);
        }
      }
      // Dev-server origin: re-report until acked so a restart of either side
      // converges; afterwards the timer keeps it fresh across agent restarts.
      if (devServerUrl && !devServerAcked) {
        devServerAcked = await postJson("/project/dev-server", { url: devServerUrl });
      }
    } finally {
      flushInFlight = false;
      if (flushQueued) {
        flushQueued = false;
        void flushRegistration();
      }
    }
  }

  function ensureReconcileTimer(): void {
    if (reconcileTimer) return;
    reconcileTimer = setInterval(() => {
      if (pendingIdentities.size > 0 || (devServerUrl && !devServerAcked)) {
        void flushRegistration();
      } else if (devServerUrl) {
        // Steady state: a tiny idempotent re-report heals an agent restart
        // even when no file changed since.
        void postJson("/project/dev-server", { url: devServerUrl }).then((ok) => {
          if (!ok) devServerAcked = false;
        });
      }
    }, RECONCILE_INTERVAL_MS);
    // Never keep the dev server (or a test process) alive for this timer.
    (reconcileTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * Batch 6: agent/project-root agreement check. The agent registers
   * identities against ITS root without knowing this project's directory —
   * a stale agent (or one started from another directory) accepts the push
   * and later serves 404s for every source lookup, which the panel used to
   * misreport as an outage. Comparing roots once per process turns that
   * silent poisoning into a warning exactly where the developer looks (the
   * Vite server log). Best-effort and non-fatal by design.
   */
  function sameRoot(a: string, b: string): boolean {
    const norm = (p: string): string => {
      let r = resolve(p);
      if (process.platform === "win32") r = r.toLowerCase();
      return r;
    };
    return norm(a) === norm(b);
  }

  async function verifyAgentRoot(): Promise<void> {
    if (rootCheckDone) return;
    rootCheckDone = true;
    let info: { root?: unknown };
    try {
      const res = await fetch(`${agentUrl}/project`);
      if (!res.ok) return;
      info = (await res.json()) as { root?: unknown };
    } catch {
      return; // agent not running — the push below will fail silently too.
    }
    if (typeof info.root !== "string" || sameRoot(info.root, projectRoot)) return;
    console.warn(
      `[devbridge] local agent project root is "${info.root}" but this Vite project is "${projectRoot}". ` +
        `Pushed identities will not resolve to source files. ` +
        `Restart the agent with DEVBRIDGE_PROJECT_ROOT set to this directory.`,
    );
  }

  async function pushIdentities(identities: DevIdentity[]) {
    if (identities.length === 0) return;
    void verifyAgentRoot();
    rememberIdentities(identities);
    ensureReconcileTimer();
    await flushRegistration();
  }

  async function reportDevServer(url: string) {
    // Best-effort like pushIdentities: the agent may not be running, and the
    // app must work regardless. The agent only accepts this from non-browser
    // callers (POSTs with an Origin header are 403), so a webpage can never
    // claim to be this project. Stored and re-reported until acked so a late
    // or restarted agent still converges (see flushRegistration).
    devServerUrl = url;
    devServerAcked = false;
    ensureReconcileTimer();
    await flushRegistration();
  }

  return {
    name: "devbridge:vite-plugin",
    enforce: "pre",

    configResolved(config) {
      isDev = config.command === "serve";
      projectRoot = config.root ?? process.cwd();
    },

    configureServer(server) {
      // Phase 5 (project detection): tell the agent which origin serves this
      // instrumented app, so the panel can match an inspected page to this
      // project instead of a bare "localhost:<port>". configureServer only
      // runs for `vite serve`, matching the plugin's dev-only activation.
      const httpServer = server.httpServer;
      if (!httpServer) return;
      httpServer.once("listening", () => {
        const addr = httpServer.address();
        const port = typeof addr === "object" && addr ? addr.port : server.config.server.port ?? 5173;
        void reportDevServer(`http://127.0.0.1:${port}`);
      });
    },

    transform(code, id) {
      if (!isDev && !options.enabled) return null;
      // Vite module ids can carry query suffixes (?v=, ?t=, ?import, …) —
      // match the include pattern against the file path, not the raw id, or
      // HMR cache-busted ids silently skip instrumentation.
      const cleanId = id.split("?")[0];
      if (!include.test(cleanId)) return null;
      if (cleanId.includes("node_modules")) return null;

      // The protocol specifies project-relative source paths
      // (@devbridge/protocol types.ts: SourceLocation.file). Vite hands us an
      // absolute module id; hashing the absolute path would make every dvi_*
      // id differ per machine and checkout (audit B7), and identity lookups
      // would only resolve while the agent's root prefix matches byte for
      // byte. Files outside the project root keep their absolute path — the
      // agent rejects them on lookup rather than us silently mislabeling.
      const rel = relative(projectRoot, cleanId);
      const projectFile =
        rel === "" || rel.startsWith("..") || rel.startsWith(sep) || /^[A-Za-z]:/.test(rel)
          ? cleanId
          : rel.split(sep).join("/");

      const { code: transformed, map, identities } = adapter.transformSource({ file: projectFile, code });
      if (identities.length > 0) void pushIdentities(identities);

      return { code: transformed, map: map as any };
    },

    // NOTE (audit U3): earlier versions injected
    // `<script type="module">import { connectRuntimeBridge } from
    // "@devbridge/adapter-react"; …</script>` into index.html. A bare
    // specifier is not resolvable in a browser module, and the consuming app
    // does not depend on `@devbridge/adapter-react`, so the injected import
    // fails and can break page load. Runtime state reporting stays opt-in:
    // components call `reportState()` / `useDevBridgeReporter()` explicitly
    // (see adapters/react/src/runtimeHook.ts and the example app's
    // CheckoutButton). This hook is therefore intentionally a no-op.
    transformIndexHtml() {
      return [];
    },
  };
}

export default devbridgePlugin;
