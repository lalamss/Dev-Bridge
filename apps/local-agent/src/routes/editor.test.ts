import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectManager } from "../ProjectManager";
import { editorRoutes, EditorUnavailableError } from "./editor";

/**
 * Route-level coverage for POST /editor/open (browser -> source -> VS Code).
 *
 * Security contract pinned here:
 *   1. projectId must equal THIS agent's project id (409 otherwise — a
 *      request for Project A is never honored by Project B's agent);
 *   2. `file` goes through SecurityManager containment (403 on traversal /
 *      absolute escape — same single choke point as /source);
 *   3. no caller-controlled commands — the opener receives an absolute,
 *      already-contained path plus numeric line/column, never a shell string;
 *   4. a missing `code` CLI is a 503 with an actionable message, not an
 *      obscure 500.
 */

let base = "";
let root = "";
let projectId = "";
let app: Express;
let server: Server;
let url = "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "devbridge-route-editor-"));
  root = join(base, "proj");
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  writeFileSync(join(root, "src", "pages", "Dashboard.tsx"), "export const x = 1;\n");
  const project = new ProjectManager(root);
  projectId = (await project.info()).id;

  const calls: Array<{ abs: string; line: number; column: number }> = [];
  (globalThis as any).__editorCalls = calls;
  const stubOpener = async (abs: string, line: number, column: number) => {
    calls.push({ abs, line, column });
  };

  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(editorRoutes(project, stubOpener));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(base, { recursive: true, force: true });
  delete (globalThis as any).__editorCalls;
});

const editorCalls = () => (globalThis as any).__editorCalls as Array<{ abs: string; line: number; column: number }>;

function openBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    projectId,
    file: "src/pages/Dashboard.tsx",
    line: 11,
    column: 4,
    ...overrides,
  });
}

describe("POST /editor/open", () => {
  it("200 + opener receives the contained absolute path and position", async () => {
    const res = await api("/editor/open", { method: "POST", body: openBody() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, file: "src/pages/Dashboard.tsx", line: 11, column: 4 });
    expect(editorCalls()).toHaveLength(1);
    expect(editorCalls()[0].abs).toBe(join(root, "src", "pages", "Dashboard.tsx"));
    expect(editorCalls()[0].line).toBe(11);
    expect(editorCalls()[0].column).toBe(4);
  });

  it("409 + opener untouched when the projectId belongs to another project", async () => {
    const res = await api("/editor/open", {
      method: "POST",
      body: openBody({ projectId: join(base, "other-project") }),
    });
    expect(res.status).toBe(409);
    expect(editorCalls()).toEqual([]);
  });

  it("403 + opener untouched for a traversal path", async () => {
    const res = await api("/editor/open", {
      method: "POST",
      body: openBody({ file: "../../package.json" }),
    });
    expect(res.status).toBe(403);
    expect(editorCalls()).toEqual([]);
  });

  it("403 for an absolute path outside the root", async () => {
    const res = await api("/editor/open", {
      method: "POST",
      body: openBody({ file: join(base, "outside.ts") }),
    });
    expect(res.status).toBe(403);
    expect(editorCalls()).toEqual([]);
  });

  it("400 for malformed line/column (schema bounds)", async () => {
    for (const bad of [{ line: 0 }, { line: -3 }, { column: -1 }, { line: 1.5 }, { file: "" }]) {
      const res = await api("/editor/open", { method: "POST", body: openBody(bad) });
      expect(res.status).toBe(400);
    }
    expect(editorCalls()).toEqual([]);
  });

  it("503 with an actionable message when the VS Code CLI is missing", async () => {
    const { editorRoutes: routes } = await import("./editor");
    const project = new ProjectManager(root);
    const failing = async () => {
      throw new EditorUnavailableError("VS Code CLI (`code`) not found on PATH.");
    };
    const app2 = express();
    app2.use(express.json());
    app2.use(routes(project, failing));
    const s2 = await new Promise<Server>((resolve) => {
      const s = app2.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = s2.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/editor/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: openBody(),
      });
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error).toMatch(/VS Code CLI/);
    } finally {
      await new Promise<void>((resolve, reject) => s2.close((e) => (e ? reject(e) : resolve())));
    }
  });
});
