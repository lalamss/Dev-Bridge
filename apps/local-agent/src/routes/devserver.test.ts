import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectManager } from "../ProjectManager";
import { EventBus } from "../ws/eventBus";
import { projectRoutes } from "./project";

/**
 * Route-level coverage for POST /project/dev-server (Phase 5 handshake).
 *
 *   - Only a non-browser client may report (browsers always send Origin on
 *     POST): a present Origin header is 403, so no webpage can claim
 *     "I am this project".
 *   - Only loopback http origins are accepted (400 otherwise).
 *   - The reported origin is reflected by GET /project for panel matching.
 */

let base = "";
let root = "";
let app: Express;
let server: Server;
let url = "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "devbridge-route-devserver-"));
  root = join(base, "proj");
  mkdirSync(root, { recursive: true });
  const project = new ProjectManager(root);
  const events = new EventBus();
  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(projectRoutes(project, events));
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
});

describe("POST /project/dev-server", () => {
  it("200 + GET /project reflects the reported loopback origin", async () => {
    const res = await api("/project/dev-server", {
      method: "POST",
      body: JSON.stringify({ url: "http://127.0.0.1:5173" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, devServerUrl: "http://127.0.0.1:5173" });
    const info = await api("/project");
    expect((info.body as any).devServerUrl).toBe("http://127.0.0.1:5173");
  });

  it("normalizes localhost and strips paths", async () => {
    const res = await api("/project/dev-server", {
      method: "POST",
      body: JSON.stringify({ url: "http://localhost:3000/some/path?x=1" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, devServerUrl: "http://localhost:3000" });
  });

  it("403 when a browser Origin header is present (no webpage may claim a project)", async () => {
    for (const origin of ["http://127.0.0.1:5173", "http://localhost:3000", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]) {
      const res = await fetch(`${url}/project/dev-server`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ url: "http://127.0.0.1:5173" }),
      });
      expect(res.status).toBe(403);
    }
    const info = await api("/project");
    expect((info.body as any).devServerUrl).toBeUndefined();
  });

  it("400 for non-loopback, non-http, and malformed urls", async () => {
    for (const bad of [
      "https://example.com",
      "http://example.com:5173",
      "https://127.0.0.1:5173",
      "http://192.168.1.10:5173",
      "not-a-url",
      "",
    ]) {
      const res = await api("/project/dev-server", {
        method: "POST",
        body: JSON.stringify({ url: bad }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("re-reporting the same origin is idempotent (plugin reconciliation safe)", async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await api("/project/dev-server", {
        method: "POST",
        body: JSON.stringify({ url: "http://127.0.0.1:5173" }),
      });
      expect(res.status).toBe(200);
    }
    const info = await api("/project");
    expect((info.body as any).devServerUrl).toBe("http://127.0.0.1:5173");
  });
});
