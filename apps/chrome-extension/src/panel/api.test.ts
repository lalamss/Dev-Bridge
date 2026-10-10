import { describe, expect, it, vi } from "vitest";
import {
  approveAndApply,
  getFiles,
  getProject,
  networkError,
  openInEditor,
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

  it("approveAndApply refuses to proceed when approve 404s", async () => {
    const fetchImpl = mockFetch(() => jsonResponse(404, { error: "gone" }));
    await expect(approveAndApply("p1", fetchImpl)).rejects.toThrow(/no longer exists/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
