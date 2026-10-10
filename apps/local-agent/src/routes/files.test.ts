import { describe, expect, it, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectManager } from "../ProjectManager";
import { filesRoutes, listProjectFiles, MAX_FILES } from "./files";

/**
 * Route-level coverage for GET /files (Files view source listing).
 *
 * Security contract pinned here:
 *   1. project-relative POSIX paths only — never absolute paths;
 *   2. node_modules / .git / dotfiles / build outputs / non-source
 *      extensions are excluded;
 *   3. symlinked directories are never descended into (escape risk);
 *   4. the listing is bounded (truncated: true past MAX_FILES) instead of
 *      growing without limit.
 */

let base = "";
let root = "";
let app: Express;
let server: Server;
let url = "";

async function getFiles(): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}/files`);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "devbridge-route-files-"));
  root = join(base, "proj");
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  writeFileSync(join(root, "src", "pages", "Dashboard.tsx"), "export const x = 1;\n");
  writeFileSync(join(root, "src", "styles.css"), ".a { color: red; }\n");
  writeFileSync(join(root, "package.json"), "{}\n");
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config.ts"), "x\n");
  writeFileSync(join(root, ".env"), "SECRET=1\n");
  writeFileSync(join(root, "notes.txt"), "hello\n");

  const project = new ProjectManager(root);
  app = express();
  app.use(filesRoutes(project));
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

describe("GET /files", () => {
  it("lists project-relative source paths only", async () => {
    const { status, body } = await getFiles();
    expect(status).toBe(200);
    expect(body.truncated).toBe(false);
    expect(body.files).toContain("src/pages/Dashboard.tsx");
    expect(body.files).toContain("src/styles.css");
    expect(body.files).toContain("package.json");
    for (const f of body.files as string[]) {
      expect(f).not.toMatch(/^[A-Z]:|^\//);
      expect(f).not.toContain("\\");
    }
  });

  it("excludes node_modules, .git, dotfiles, and non-source extensions", async () => {
    const { body } = await getFiles();
    const files = body.files as string[];
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.includes(".git"))).toBe(false);
    expect(files).not.toContain(".env");
    expect(files).not.toContain("notes.txt");
  });

  it("never descends into symlinked directories", async () => {
    const outside = join(base, "outside");
    mkdirSync(join(outside, "src"), { recursive: true });
    writeFileSync(join(outside, "src", "Evil.tsx"), "x\n");
    try {
      symlinkSync(outside, join(root, "linked"), "junction");
    } catch {
      return; // symlink creation needs privileges on some machines — skip
    }
    const { body } = await getFiles();
    const files = body.files as string[];
    expect(files.some((f) => f.includes("linked"))).toBe(false);
    expect(files.some((f) => f.includes("Evil"))).toBe(false);
  });

  it("marks the listing truncated past the bound", () => {
    mkdirSync(join(root, "many"), { recursive: true });
    for (let i = 0; i < 12; i++) {
      writeFileSync(join(root, "many", `f${i}.ts`), "export const x = 1;\n");
    }
    const small = listProjectFiles(root, 5);
    expect(small.files).toHaveLength(5);
    expect(small.truncated).toBe(true);
    const full = listProjectFiles(root, MAX_FILES);
    expect(full.truncated).toBe(false);
  });
});
