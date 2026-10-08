import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitManager } from "./GitManager";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §P5/S7:
 * `GitManager.checkpoint` used to run a bare `git add -A` from the project
 * root, so a project nested inside a larger repo committed the ENTIRE
 * repository — including unrelated work-in-progress outside the project.
 * Staging is now scoped to the project tree.
 */

let base = "";
let repo = "";
let project = "";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "devbridge-git-"));
  repo = join(base, "repo");
  project = join(repo, "examples", "react-vite");
  mkdirSync(project, { recursive: true });
  git(base, "init", "-q", "repo");
  git(repo, "config", "user.email", "test@devbridge.local");
  git(repo, "config", "user.name", "DevBridge Test");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "repo\n");
  writeFileSync(join(project, "app.tsx"), "v1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "initial");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("GitManager.checkpoint scope", () => {
  it("commits only the project tree, never unrelated repo changes", async () => {
    // Unrelated work-in-progress OUTSIDE the project root.
    writeFileSync(join(repo, "UNRELATED.txt"), "wip\n");
    // Change inside the project (as an applied patch would leave it).
    writeFileSync(join(project, "app.tsx"), "v2\n");

    const manager = new GitManager(project);
    await manager.checkpoint("edit app.tsx via DevBridge", null);

    const committed = git(repo, "show", "--name-only", "--pretty=format:", "HEAD");
    expect(committed).toContain("app.tsx");
    expect(committed).not.toContain("UNRELATED.txt");
    // …and the unrelated file is still uncommitted working-tree state.
    expect(git(repo, "status", "--porcelain")).toContain("UNRELATED.txt");
  });
});
