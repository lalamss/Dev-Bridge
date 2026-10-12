import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { devbridgePlugin } from "./index";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §C2, §B7, §U3.
 *
 * "Hover produces nothing" was caused by the example app never running this
 * plugin — and the plugin itself had two latent defects: it stamped absolute
 * filesystem paths into identities (so ids differed per machine), and it
 * injected a bare-specifier runtime import that browsers cannot resolve.
 */

const SAMPLE_TSX = `export function App() {
  return (
    <main>
      <h1>Hello</h1>
    </main>
  );
}
`;

function makePlugin(opts: Parameters<typeof devbridgePlugin>[0] = {}) {
  const plugin = devbridgePlugin({ agentUrl: "http://127.0.0.1:9", ...opts }) as {
    configResolved: (config: unknown) => void;
    transform: (code: string, id: string) => { code: string } | null;
    transformIndexHtml: () => unknown;
  };
  return plugin;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bulkCall() {
  const calls = vi.mocked(fetch).mock.calls as [string, { body?: string }][];
  const found = calls.find(([url, init]) => url.endsWith("/identity/bulk") && init?.body);
  expect(found, "expected a bulk POST among fetch calls").toBeDefined();
  return JSON.parse(found![1].body!) as { identities: { source: { file: string } }[] };
}

describe("devbridgePlugin activation policy", () => {
  it("transforms TSX in dev (serve) mode", () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    const out = plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    expect(out).not.toBeNull();
    expect(out!.code).toContain("data-dev-id");
  });

  it("leaves production builds untouched unless explicitly opted in", () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "build", root: "/proj" });
    expect(plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx")).toBeNull();
  });

  it("instruments builds when enabled: true is an explicit design decision", () => {
    const plugin = makePlugin({ enabled: true });
    plugin.configResolved({ command: "build", root: "/proj" });
    const out = plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    expect(out).not.toBeNull();
    expect(out!.code).toContain("data-dev-id");
  });

  it("ignores node_modules, and pushes no identities for files without JSX", () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    expect(plugin.transform(SAMPLE_TSX, "/proj/node_modules/foo/App.tsx")).toBeNull();
    // Plain .ts/.js files still pass through the transform (JSX can legally
    // appear there), but with no JSX elements nothing is registered.
    const out = plugin.transform("const x = 1;", "/proj/src/util.ts");
    expect(out).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("devbridgePlugin identity paths (audit B7)", () => {
  it("records project-relative source files, not absolute module ids", async () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    // let the fire-and-forget POSTs land
    await new Promise((r) => setTimeout(r, 10));
    const body = bulkCall();
    expect(body.identities.length).toBeGreaterThan(0);
    for (const identity of body.identities) {
      expect(identity.source.file).toBe("src/App.tsx");
    }
  });

  it("strips Vite query suffixes before computing the relative path", async () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx?v=abc123");
    await new Promise((r) => setTimeout(r, 10));
    expect(bulkCall().identities[0].source.file).toBe("src/App.tsx");
  });
});

describe("devbridgePlugin index-html (audit U3)", () => {
  it("does not inject an unresolvable bare-specifier runtime import", () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    expect(plugin.transformIndexHtml()).toEqual([]);
  });
});

describe("devbridgePlugin agent-root agreement (Batch 6)", () => {
  function fetchMockFor(projectRoot: string | null) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/project")) {
        return { ok: true, json: async () => (projectRoot === null ? {} : { root: projectRoot }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    return warn;
  }

  it("warns once when the agent serves a different project root", async () => {
    const warn = fetchMockFor("/other-root");
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    plugin.transform(SAMPLE_TSX, "/proj/src/Other.tsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(warn).toHaveBeenCalledTimes(1);
    const text = warn.mock.calls[0]![0] as string;
    expect(text).toContain("/other-root");
    expect(text).toContain("/proj");
    expect(text).toContain("DEVBRIDGE_PROJECT_ROOT");
  });

  it("stays silent when the roots agree", async () => {
    const warn = fetchMockFor("/proj");
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the agent is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    expect(() => plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx")).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("devbridgePlugin reliable registration (Settings status fix)", () => {
  function bulkBodies() {
    const calls = vi.mocked(fetch).mock.calls as [string, { method?: string; body?: string }][];
    return calls
      .filter(([url, init]) => url.endsWith("/identity/bulk") && init?.body)
      .map(([, init]) => JSON.parse(init!.body!) as { identities: { id: string; source: { file: string } }[] });
  }

  function flakyAgent() {
    let agentUp = false;
    const posted: Array<{ url: string; body?: string }> = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.endsWith("/project")) {
        return { ok: true, json: async () => ({ root: "/proj" }) } as Response;
      }
      if (!agentUp) throw new Error("ECONNREFUSED");
      posted.push({ url: u, body: (init as { body?: string } | undefined)?.body });
      return { ok: true, json: async () => ({}) } as Response;
    });
    return { setUp: (up: boolean) => { agentUp = up; }, posted };
  }

  function postedBodies(posted: Array<{ url: string; body?: string }>, suffix: string) {
    return posted
      .filter((p) => p.url.endsWith(suffix) && p.body)
      .map((p) => JSON.parse(p.body!) as { identities: { id: string; source: { file: string } }[] });
  }

  it("keeps unacknowledged identities and delivers them on the next flush (agent down, then up)", async () => {
    const agent = flakyAgent();
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    expect(postedBodies(agent.posted, "/identity/bulk")).toHaveLength(0);
    agent.setUp(true);
    plugin.transform(SAMPLE_TSX, "/proj/src/Other.tsx");
    await new Promise((r) => setTimeout(r, 20));
    const bodies = postedBodies(agent.posted, "/identity/bulk");
    expect(bodies.length).toBeGreaterThan(0);
    const last = bodies[bodies.length - 1]!;
    const files = last.identities.map((i) => i.source.file).sort();
    // Nothing lost: the failed first transform is included with the second.
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/Other.tsx");
  });

  it("re-reports the dev-server URL on the next flush when the first report fails", async () => {
    const agent = flakyAgent();
    const plugin = makeServingPluginForRetry();
    plugin.configResolved({ command: "serve", root: "/proj" });
    const { listeners, server } = fakeServerForRetry(5199);
    plugin.configureServer(server);
    listeners.get("listening")!();
    await new Promise((r) => setTimeout(r, 20));
    expect(agent.posted.filter((p) => p.url.endsWith("/project/dev-server"))).toHaveLength(0);
    agent.setUp(true);
    (plugin as unknown as { transform: (code: string, id: string) => unknown }).transform(SAMPLE_TSX, "/proj/src/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    const posts = agent.posted.filter((p) => p.url.endsWith("/project/dev-server"));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body!)).toEqual({ url: "http://127.0.0.1:5199" });
    // The piggybacked identities arrived in the same flush.
    expect(postedBodies(agent.posted, "/identity/bulk").length).toBeGreaterThan(0);
  });

  it("never sends duplicate ids within one flush on HMR re-transforms", async () => {
    const plugin = makePlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
    await new Promise((r) => setTimeout(r, 20));
    for (const body of bulkBodies()) {
      const ids = body.identities.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("reconciles pending work on the timer without new transforms", async () => {
    vi.useFakeTimers();
    try {
      const agent = flakyAgent();
      const plugin = makePlugin();
      plugin.configResolved({ command: "serve", root: "/proj" });
      plugin.transform(SAMPLE_TSX, "/proj/src/App.tsx");
      await vi.advanceTimersByTimeAsync(20);
      expect(postedBodies(agent.posted, "/identity/bulk")).toHaveLength(0);
      agent.setUp(true);
      await vi.advanceTimersByTimeAsync(15000);
      await vi.advanceTimersByTimeAsync(20);
      expect(postedBodies(agent.posted, "/identity/bulk").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  function makeServingPluginForRetry() {
    return makePlugin() as unknown as {
      configResolved: (config: unknown) => void;
      configureServer: (server: unknown) => void;
    };
  }

  function fakeServerForRetry(port: number) {
    const listeners = new Map<string, () => void>();
    return {
      listeners,
      server: {
        config: { server: { port } },
        httpServer: {
          once: (event: string, cb: () => void) => {
            listeners.set(event, cb);
          },
          address: () => ({ port }),
        },
      },
    };
  }
});

describe("devbridgePlugin dev-server report (project detection)", () => {
  function makeServingPlugin() {
    const plugin = makePlugin() as unknown as {
      configResolved: (config: unknown) => void;
      configureServer: (server: unknown) => void;
    };
    return plugin;
  }

  function fakeServer(port: number) {
    const listeners = new Map<string, () => void>();
    return {
      listeners,
      server: {
        config: { server: { port } },
        httpServer: {
          once: (event: string, cb: () => void) => {
            listeners.set(event, cb);
          },
          address: () => ({ port }),
        },
      },
    };
  }

  function devServerPosts() {
    const calls = vi.mocked(fetch).mock.calls as [string, { method?: string; body?: string }][];
    return calls.filter(([url, init]) => url.endsWith("/project/dev-server") && init?.method === "POST");
  }

  it("POSTs the loopback origin once the server is listening", async () => {
    const plugin = makeServingPlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    const { listeners, server } = fakeServer(5199);
    plugin.configureServer(server);
    listeners.get("listening")!();
    await new Promise((r) => setTimeout(r, 10));
    const posts = devServerPosts();
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]![1].body!)).toEqual({ url: "http://127.0.0.1:5199" });
  });

  it("never throws when the agent is down (best-effort report)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const plugin = makeServingPlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    const { listeners, server } = fakeServer(5199);
    expect(() => plugin.configureServer(server)).not.toThrow();
    listeners.get("listening")!();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("does nothing when there is no http server", () => {
    const plugin = makeServingPlugin();
    plugin.configResolved({ command: "serve", root: "/proj" });
    expect(() => plugin.configureServer({ config: { server: {} }, httpServer: null })).not.toThrow();
    expect(devServerPosts()).toHaveLength(0);
  });
});
