import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BULK_IDENTITIES } from "@devbridge/protocol";
import { ProjectManager } from "../ProjectManager";
import { EventBus } from "../ws/eventBus";
import { projectRoutes } from "./project";

/**
 * Route-level regression coverage for audit A3 and Batch 3 §4:
 * POST /identity/bulk is all-or-nothing — schema, batch-size, and
 * canonical containment checks all run BEFORE anything is upserted, so one
 * poisoned `source.file` (traversal, absolute escape, symlink/junction)
 * can never create a partial registry that later feeds GET /source.
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
  return { status: res.status, text: await res.text() };
}

function identity(id: string, file: string) {
  return {
    id,
    framework: "react",
    component: "App",
    source: {
      file,
      start: { line: 1, column: 0 },
      end: { line: 1, column: 5 },
    },
    parentId: null,
  };
}

const hexId = (n: number) => `dvi_${n.toString(16).padStart(8, "0")}`;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "devbridge-route-bulk-"));
  root = join(base, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "App.tsx"), "export const x = 1;\n");
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

async function storedIds(): Promise<string[]> {
  const res = await fetch(`${url}/identities`);
  const list = (await res.json()) as { id: string }[];
  return list.map((i) => i.id);
}

describe("POST /identity/bulk", () => {
  it("204 + stored for a valid batch (contract unchanged)", async () => {
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({ identities: [identity(hexId(1), "src/App.tsx")] }),
    });
    expect(res.status).toBe(204);
    expect(await storedIds()).toContain(hexId(1));
  });

  it("accepts identities for files that do not exist yet (HMR ordering)", async () => {
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({ identities: [identity(hexId(2), "src/NotYetWritten.tsx")] }),
    });
    expect(res.status).toBe(204);
  });

  it("403 + nothing stored for a traversal item (batch is atomic)", async () => {
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({
        identities: [identity(hexId(3), "src/App.tsx"), identity("dvi_deadbeef", "../../package.json")],
      }),
    });
    expect(res.status).toBe(403);
    expect(await storedIds()).not.toContain(hexId(3));
  });

  it("403 for an absolute path outside the root", async () => {
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({ identities: [identity("dvi_deadbeef", join(base, "outside.txt"))] }),
    });
    expect(res.status).toBe(403);
    expect(await storedIds()).toEqual([]);
  });

  it("403 for a junction escape inside the root", async () => {
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "evil.ts"), "x\n");
    symlinkSync(outside, join(root, "linked"), "junction");
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({ identities: [identity("dvi_deadbeef", "linked/evil.ts")] }),
    });
    expect(res.status).toBe(403);
    expect(await storedIds()).toEqual([]);
  });

  it("400 + nothing stored for a malformed entry", async () => {
    const res = await api("/identity/bulk", {
      method: "POST",
      body: JSON.stringify({
        identities: [identity(hexId(4), "src/App.tsx"), { id: "not-a-dev-id", framework: "react" }],
      }),
    });
    expect(res.status).toBe(400);
    expect(await storedIds()).not.toContain(hexId(4));
  });

  it("400 for an oversized batch without touching the registry", async () => {
    const identities = Array.from({ length: MAX_BULK_IDENTITIES + 1 }, (_, i) =>
      identity(hexId(100000 + i), "src/App.tsx"),
    );
    const res = await api("/identity/bulk", { method: "POST", body: JSON.stringify({ identities }) });
    expect(res.status).toBe(400);
    expect(await storedIds()).toEqual([]);
  });

  it("re-pushed identities upsert by id: reloads and HMR never duplicate the registry", async () => {
    const batch = (extra: string) =>
      JSON.stringify({ identities: [identity(hexId(1), "src/App.tsx"), identity(hexId(2), extra)] });
    for (const file of ["src/App.tsx", "src/Other.tsx"]) {
      const res = await api("/identity/bulk", { method: "POST", body: batch(file) });
      expect(res.status).toBe(204);
    }
    const ids = await storedIds();
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    // The moved id left no ghost in its previous file's listing.
    const appRes = await fetch(`${url}/identities?file=${encodeURIComponent("src/App.tsx")}`);
    const appIds = ((await appRes.json()) as { id: string }[]).map((i) => i.id);
    expect(appIds).not.toContain(hexId(2));
    const otherRes = await fetch(`${url}/identities?file=${encodeURIComponent("src/Other.tsx")}`);
    const otherIds = ((await otherRes.json()) as { id: string }[]).map((i) => i.id);
    expect(otherIds).toContain(hexId(2));
  });

  it("an empty registry reads back empty (missing registration, not an error)", async () => {
    expect(await storedIds()).toEqual([]);
  });
});
