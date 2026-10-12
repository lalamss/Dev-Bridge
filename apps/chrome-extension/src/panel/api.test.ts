import { describe, expect, it, vi } from "vitest";
import {
  approveAndApply,
  getFiles,
  getProject,
  getVSCodeStatus,
  networkError,
  openInEditor,
  openVSCodeDownloadPage,
  VSCODE_DOWNLOAD_URL,
  VSCodeNotDetectedError,
} from "./api";

/**
 * Agent-client coverage for the panel's Files view and VS Code integration.
 *
 * Pins the honest-error contract: unreachable agent, unknown routes
 * (older agent without GET /files), project mismatch, and missing `code`
 * CLI each surface a distinct actionable message — never invented data.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: unknown, init?: unknown) => impl(url as string, init as RequestInit)) as unknown as typeof fetch;
}

describe("panel api client", () => {
  it("networkError maps a failed fetch to the devbridge-start hint", () => {
    expect(networkError(new TypeError("fetch failed")).message).toMatch(/devbridge start/);
  });

  it("getProject returns the agent project record", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, { id: "/repo", root: "/repo", framework: "react" }));
    const project = await getProject(fetchImpl);
    expect(project.framework).toBe("react");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("getProject throws the network hint when the agent is down", async () => {
    const fetchImpl = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(getProject(fetchImpl)).rejects.toThrow(/devbridge start/);
  });

  it("getFiles explains an older agent without the route instead of an empty list", async () => {
    const fetchImpl = mockFetch(() => new Response("not found", { status: 404 }));
    await expect(getFiles(fetchImpl)).rejects.toThrow(/GET \/files/);
  });

  it("getFiles returns paths and the truncation flag", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(200, { files: ["src/App.tsx"], truncated: false }));
    expect(await getFiles(fetchImpl)).toEqual({ files: ["src/App.tsx"], truncated: false });
  });

  it("openInEditor maps 409 to the wrong-project message", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(409, { error: "nope" }));
    await expect(
      openInEditor({ projectId: "a", file: "src/App.tsx", line: 1, column: 0 }, fetchImpl),
    ).rejects.toThrow(/different project/);
  });

  it("openInEditor maps 503 to the missing code-CLI message", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(503, { error: "no code cli" }));
    await expect(
      openInEditor({ projectId: "a", file: "src/App.tsx", line: 1, column: 0 }, fetchImpl),
    ).rejects.toThrow(/no code cli/);
  });

  it("openInEditor maps a launch-failed 503 to a plain error (no install dialog)", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(503, { error: "launcher exploded", code: "launch-failed" }));
    const promise = openInEditor({ projectId: "a", file: "src/App.tsx", line: 1, column: 0 }, fetchImpl);
    await expect(promise).rejects.toThrow(/launcher exploded/);
    await expect(promise).rejects.not.toBeInstanceOf(VSCodeNotDetectedError);
  });

  it("openInEditor throws a typed not-detected error on 503 (drives the install dialog)", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(503, { error: "VS Code was not detected." }));
    const promise = openInEditor({ projectId: "a", file: "src/App.tsx", line: 1, column: 0 }, fetchImpl);
    await expect(promise).rejects.toBeInstanceOf(VSCodeNotDetectedError);
    await expect(promise).rejects.toThrow(/not detected/);
  });

  it("openInEditor maps 404 to the moved-or-deleted hint", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(404, { error: "gone" }));
    await expect(
      openInEditor({ projectId: "a", file: "src/App.tsx", line: 1, column: 0 }, fetchImpl),
    ).rejects.toThrow(/moved, renamed, or deleted/);
  });

  it("approveAndApply refuses to proceed when approve 404s", async () => {
    const fetchImpl = mockFetch(() => new Response("not found", { status: 404 }));
    await expect(approveAndApply("p1", fetchImpl)).rejects.toThrow(/no longer exists/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("getVSCodeStatus reports a found installation with its channel", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://localhost:4577/editor/vscode?refresh=1");
      return jsonResponse(200, { ok: true, found: true, via: "install-location" });
    });
    await expect(getVSCodeStatus(true, fetchImpl)).resolves.toMatchObject({ ok: true, found: true });
  });

  it("getVSCodeStatus reports missing with the agent reason", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://localhost:4577/editor/vscode");
      return jsonResponse(503, { ok: false, found: false, error: "VS Code was not detected." });
    });
    await expect(getVSCodeStatus(false, fetchImpl)).resolves.toMatchObject({ ok: false, found: false });
  });

  it("getVSCodeStatus maps a dead agent to the start hint", async () => {
    const fetchImpl = mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(getVSCodeStatus(true, fetchImpl)).rejects.toThrow(/devbridge start/);
  });

  it("openVSCodeDownloadPage uses the fixed official URL through chrome.tabs", async () => {
    expect(VSCODE_DOWNLOAD_URL).toBe("https://code.visualstudio.com/download");
    const created: unknown[] = [];
    (globalThis as any).chrome = { tabs: { create: (o: unknown) => { created.push(o); } } };
    try {
      openVSCodeDownloadPage();
      expect(created).toEqual([{ url: "https://code.visualstudio.com/download" }]);
    } finally {
      delete (globalThis as any).chrome;
    }
  });

  it("openVSCodeDownloadPage falls back to window.open without chrome.tabs", async () => {
    const opened: unknown[] = [];
    (globalThis as any).window = { open: (...a: unknown[]) => { opened.push(a); } };
    try {
      openVSCodeDownloadPage();
      expect(opened).toEqual([["https://code.visualstudio.com/download", "_blank", "noopener"]]);
    } finally {
      delete (globalThis as any).window;
    }
  });
});
