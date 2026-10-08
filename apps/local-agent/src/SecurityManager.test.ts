import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathEscapeError, SecurityManager } from "./SecurityManager";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §S5.
 *
 * The lexical-only containment check this replaced was demonstrably bypassable:
 * a symlink inside the project root pointing at a file above it turned
 * GET /source into an arbitrary-file-read. These tests pin both halves of the
 * check — traversal *and* symlink — so neither can be dropped again.
 */

function makeProject(): { root: string; outside: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "devbridge-sec-"));
  const root = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src", "Button.tsx"), "export const Button = 1;\n");
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");
  return { root, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe("SecurityManager.assertPathInProject", () => {
  it("accepts a project-relative path and returns its canonical location", () => {
    const { root, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      const resolved = security.assertPathInProject("src/Button.tsx");
      expect(resolved.endsWith(join("src", "Button.tsx"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("accepts an absolute path inside the root", () => {
    const { root, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      const abs = join(root, "src", "Button.tsx");
      expect(security.assertPathInProject(abs)).toBe(security.assertPathInProject("src/Button.tsx"));
    } finally {
      cleanup();
    }
  });

  it("rejects relative traversal above the root", () => {
    const { root, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject("../outside/secret.txt")).toThrow(PathEscapeError);
    } finally {
      cleanup();
    }
  });

  it("rejects an absolute path outside the root", () => {
    const { root, outside, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject(join(outside, "secret.txt"))).toThrow(
        PathEscapeError,
      );
    } finally {
      cleanup();
    }
  });

  it("rejects a sibling directory that merely shares the root's name prefix", () => {
    const base = mkdtempSync(join(tmpdir(), "devbridge-prefix-"));
    try {
      const root = join(base, "app");
      const sibling = join(base, "app-secrets");
      mkdirSync(root, { recursive: true });
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(sibling, "secret.txt"), "TOP SECRET\n");
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject(join(sibling, "secret.txt"))).toThrow(
        PathEscapeError,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  // The regression this whole batch exists for. Directory junctions are used
  // rather than file symlinks because Windows requires elevation (or Developer
  // Mode) to create a file symlink — a junction needs neither, and is what
  // pnpm/npm actually create inside a project tree.
  it("rejects a junction inside the root that points outside it", () => {
    const { root, outside, cleanup } = makeProject();
    try {
      symlinkSync(outside, join(root, "escape"), "junction");
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject("escape")).toThrow(PathEscapeError);
    } finally {
      cleanup();
    }
  });

  it("rejects a traversal that reaches a real path only through a junction", () => {
    const { root, outside, cleanup } = makeProject();
    try {
      symlinkSync(outside, join(root, "linked-dir"), "junction");
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject("linked-dir/secret.txt")).toThrow(PathEscapeError);
    } finally {
      cleanup();
    }
  });

  it("allows a path that does not exist yet, as long as its parent chain is inside", () => {
    const { root, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject("src/components/deep/New.tsx")).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it("still rejects a new file whose nearest existing ancestor escapes via a junction", () => {
    const { root, outside, cleanup } = makeProject();
    try {
      symlinkSync(outside, join(root, "linked-dir"), "junction");
      const security = new SecurityManager(root);
      expect(() => security.assertPathInProject("linked-dir/does/not/exist.tsx")).toThrow(
        PathEscapeError,
      );
    } finally {
      cleanup();
    }
  });

  it("does not expose the resolved absolute path in the error message", () => {
    const { root, outside, cleanup } = makeProject();
    try {
      const security = new SecurityManager(root);
      try {
        security.assertPathInProject("../outside/secret.txt");
        throw new Error("expected PathEscapeError");
      } catch (err) {
        expect(err).toBeInstanceOf(PathEscapeError);
        // The message quotes the *attempted* path only — never the canonical
        // absolute location, which would leak the filesystem layout to a caller.
        expect((err as Error).message).not.toContain(outside);
      }
    } finally {
      cleanup();
    }
  });
});