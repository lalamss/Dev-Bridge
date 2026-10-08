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
