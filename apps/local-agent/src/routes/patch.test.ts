import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectManager } from "../ProjectManager";
import { EventBus } from "../ws/eventBus";
import { patchRoutes } from "./patch";

/**
 * Route-level regression coverage for Batch 3 §1/§2/§5: the
 * POST /patch/:id/apply status contract. Reproduced pre-fix failures:
 * a target replaced by a directory surfaced as 404 "patch not found" (audit
 * A5), and a junction swapped in after preview wrote outside the project
 * root whenever the bytes happened to hash-match.
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
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "devbridge-route-patch-"));
  root = join(base, "proj");
  mkdirSync(root, { recursive: true });
  const project = new ProjectManager(root);
  const events = new EventBus(); // unattached: broadcast() iterates zero clients
  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(patchRoutes(project, events));
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

async function propose(file: string, newContent: string, original?: string) {
  if (original !== undefined) {
    writeFileSync(join(root, file), original);
  }
  const res = await api("/patch", {
    method: "POST",
    body: JSON.stringify({ file, newContent, origin: "manual" }),
  });
  expect(res.status).toBe(201);
  return (res.body as { id: string }).id;
}

describe("POST /patch/:id/apply status contract", () => {
  it("200 + applied on the happy path", async () => {
    const id = await propose("a.txt", "new\n", "old\n");
    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: "applied" });
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("new\n");
  });

  it("409 conflicted/changed when the source changed after preview; file kept", async () => {
    const id = await propose("a.txt", "new\n", "old\n");
    writeFileSync(join(root, "a.txt"), "someone else\n");
    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: "conflicted", reason: "changed" });
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("someone else\n");
  });

  it("409 conflicted/deleted when the source was deleted after preview", async () => {
    const id = await propose("a.txt", "new\n", "old\n");
    rmSync(join(root, "a.txt"));
    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ status: "conflicted", reason: "deleted" });
  });

  it("500 write-failed (not 404) when the target became a directory", async () => {
    const id = await propose("f.txt", "new\n", "data\n");
    rmSync(join(root, "f.txt"));
    mkdirSync(join(root, "f.txt"));
    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "write-failed" });
  });

  it("404 for an unknown patch id", async () => {
    const res = await api("/patch/patch_nope/apply", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("403 when a junction is swapped in after preview; outside file kept", async () => {
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "t.txt"), "same\n");
    writeFileSync(join(outside, "t.txt"), "same\n");
    const id = await propose("sub/t.txt", "PWNED\n");
    rmSync(join(root, "sub"), { recursive: true });
    symlinkSync(outside, join(root, "sub"), "junction");

    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(readFileSync(join(outside, "t.txt"), "utf-8")).toBe("same\n");
  });

  it("403 at propose time for traversal paths (both separators)", async () => {
    for (const file of ["../../evil.txt", "..\\..\\evil.txt"]) {
      const res = await api("/patch", {
        method: "POST",
        body: JSON.stringify({ file, newContent: "x\n", origin: "manual" }),
      });
      expect(res.status).toBe(403);
    }
  });

  it("403 for absolute paths outside the root (audit U6: join/resolve disagreement is unreachable)", async () => {
    // PatchEngine joins while SecurityManager resolves; on Windows the two
    // disagree on absolute inputs — but the resolve-based guard runs first
    // (at propose AND inside apply), so the join never sees them.
    const res = await api("/patch", {
      method: "POST",
      body: JSON.stringify({ file: join(base, "outside.txt"), newContent: "x\n", origin: "manual" }),
    });
    expect(res.status).toBe(403);
  });

  it("400 for oversized patch bodies", async () => {
    const res = await api("/patch", {
      method: "POST",
      body: JSON.stringify({ file: "big.txt", newContent: "x".repeat(2 * 1024 * 1024 + 1), origin: "manual" }),
    });
    expect(res.status).toBe(400);
  });

  it("creates new files (nonexistent at preview) with 200", async () => {
    const id = await propose("fresh/new.txt", "hello\n");
    const res = await api(`/patch/${id}/apply`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(readFileSync(join(root, "fresh/new.txt"), "utf-8")).toBe("hello\n");
  });
});
