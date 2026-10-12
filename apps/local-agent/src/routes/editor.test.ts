import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VSCodeStatusSchema } from "@devbridge/protocol";
import { ProjectManager } from "../ProjectManager";
import { editorRoutes, EditorUnavailableError } from "./editor";
import { VSCodeNotInstalledError } from "../vscode";

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

  it("404 + opener untouched for a project file that no longer exists", async () => {
    const res = await api("/editor/open", {
      method: "POST",
      body: openBody({ file: "src/pages/Missing.tsx" }),
    });
    expect(res.status).toBe(404);
    expect(String((res.body as any)?.error ?? "")).toMatch(/not found/i);
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

  it("503/not-installed when discovery finds nothing; launch problems stay distinct", async () => {
    const { editorRoutes: routes } = await import("./editor");
    const { VSCodeNotInstalledError } = await import("../vscode");
    async function postWith(opener: (abs: string, line: number, column: number) => Promise<void>) {
      const project = new ProjectManager(root);
      const appN = express();
      appN.use(express.json());
      appN.use(routes(project, opener));
      const sN = await new Promise<Server>((resolve) => {
        const s = appN.listen(0, "127.0.0.1", () => resolve(s));
      });
      const addr = sN.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/editor/open`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: openBody(),
        });
        return { status: res.status, body: (await res.json()) as any };
      } finally {
        await new Promise<void>((resolve, reject) => sN.close((e) => (e ? reject(e) : resolve())));
      }
    }
    // Nothing installed: discovery failure with the install-dialog code.
    const missing = await postWith(async () => {
      throw new VSCodeNotInstalledError("VS Code was not detected on this machine.");
    });
    expect(missing.status).toBe(503);
    expect(missing.body.code).toBe("not-installed");
    // Installed but unstartable: launch failure code, never "not installed".
    const unstartable = await postWith(async () => {
      throw new EditorUnavailableError('VS Code launcher "C:\\VS Code\\Code.exe" could not be started.');
    });
    expect(unstartable.status).toBe(503);
    expect(unstartable.body.code).toBe("launch-failed");
    // A launcher that ran and failed: generic 500, not a 503 at all.
    const crashed = await postWith(async () => {
      throw new Error('VS Code CLI "code.cmd" exited (code 1)');
    });
    expect(crashed.status).toBe(500);
    expect(String(crashed.body.error)).toMatch(/exited/);
  });
});

describe("GET /editor/vscode", () => {
  async function statusApp(detect: () => Promise<{ executable: string; via: "config" | "PATH" | "install-location" | "windows-resolution" }>) {
    const project = new ProjectManager(root);
    const stubOpener = async () => {};
    const app3 = express();
    app3.use(express.json());
    app3.use(editorRoutes(project, stubOpener, detect));
    const s3 = await new Promise<Server>((resolve) => {
      const s = app3.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = s3.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return { s3, port };
  }

  async function close(s3: Server) {
    await new Promise<void>((resolve, reject) => s3.close((e) => (e ? reject(e) : resolve())));
  }

  it("200 + typed found body when an installation resolves", async () => {
    const { s3, port } = await statusApp(async () => ({
      executable: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      via: "install-location",
    }));
    try {
      const res = await fetch(`http://127.0.0.1:${port}/editor/vscode`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown;
      const parsed = VSCodeStatusSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      expect(body).toMatchObject({ ok: true, found: true, via: "install-location" });
    } finally {
      await close(s3);
    }
  });

  it("503 + typed reason when nothing resolves, and refresh re-checks", async () => {
    let calls = 0;
    const { s3, port } = await statusApp(async () => {
      calls += 1;
      throw new VSCodeNotInstalledError("VS Code was not detected on this machine.");
    });
    try {
      const first = await fetch(`http://127.0.0.1:${port}/editor/vscode`);
      expect(first.status).toBe(503);
      const body = (await first.json()) as unknown;
      expect(VSCodeStatusSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({ ok: false, found: false });
      expect(String((body as any).error)).toMatch(/not detected/);
      // ?refresh=1 forces a fresh detection pass instead of a cached answer.
      const second = await fetch(`http://127.0.0.1:${port}/editor/vscode?refresh=1`);
      expect(second.status).toBe(503);
      expect(calls).toBe(2);
    } finally {
      await close(s3);
    }
  });

  it("discovers a fresh install on retry after failure", async () => {
    let installed = false;
    const { s3, port } = await statusApp(async () => {
      if (!installed) throw new VSCodeNotInstalledError("VS Code was not detected on this machine.");
      return { executable: "C:\\VS Code\\Code.exe", via: "install-location" as const };
    });
    try {
      expect((await fetch(`http://127.0.0.1:${port}/editor/vscode`)).status).toBe(503);
      installed = true; // user installs VS Code, then Check again
      const retry = await fetch(`http://127.0.0.1:${port}/editor/vscode?refresh=1`);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ ok: true, found: true });
    } finally {
      await close(s3);
    }
  });
});
