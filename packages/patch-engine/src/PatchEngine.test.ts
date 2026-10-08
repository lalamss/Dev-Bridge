import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  PatchConflictError,
  PatchEngine,
  PatchNotFoundError,
  PatchWriteError,
} from "./PatchEngine";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §P3/P4 and
 * Batch 3 §1–§2: atomic patch application and conflict handling.
 *
 * Each test works in a fresh temp project root. Junctions (not file
 * symlinks) are used for escape tests because Windows creates file symlinks
 * only with elevation — junctions need none, and defeat a lexical-only
 * check exactly the same way.
 */

let base = "";
let root = "";

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "devbridge-patch-"));
  root = join(base, "proj");
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function create(engine: PatchEngine, file: string, newContent: string, original?: string) {
  if (original !== undefined) {
    mkdirSync(join(root, file.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(join(root, file), original);
  }
  return engine.create({ projectRoot: root, file, newContent, origin: "manual" });
}

describe("PatchEngine.apply — happy paths", () => {
  it("modifies an existing file and leaves no temp files behind", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    const applied = engine.apply(root, patch.id);
    expect(applied.status).toBe("applied");
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("new\n");
    expect(readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("creates a new file including missing parent directories", () => {
    const engine = new PatchEngine();
    const patch = engine.create({
      projectRoot: root,
      file: "nested/dir/b.txt",
      newContent: "created\n",
      origin: "manual",
    });
    engine.apply(root, patch.id);
    expect(readFileSync(join(root, "nested/dir/b.txt"), "utf-8")).toBe("created\n");
  });

  it("round-trips unicode content byte-identically", () => {
    const engine = new PatchEngine();
    const body = "héllo wörld — emoji 🎯\n第二行\n";
    const patch = create(engine, "ünïcode-🎯.txt", body + "v2\n", body + "v1\n");
    engine.apply(root, patch.id);
    expect(readFileSync(join(root, "ünïcode-🎯.txt"), "utf-8")).toBe(body + "v2\n");
  });

  it("preserves the original file mode", () => {
    if (process.platform === "win32") return; // modes are a no-op on Windows
    const engine = new PatchEngine();
    const target = join(root, "mode.sh");
    writeFileSync(target, "old\n", { mode: 0o755 });
    const patch = engine.create({ projectRoot: root, file: "mode.sh", newContent: "new\n", origin: "manual" });
    engine.apply(root, patch.id);
    expect(statSync(target).mode & 0o777).toBe(0o755);
  });
});

describe("PatchEngine.apply — conflicts (original untouched)", () => {
  it("rejects when the file changed after preview", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    writeFileSync(join(root, "a.txt"), "someone else\n");
    expect(() => engine.apply(root, patch.id)).toThrow(PatchConflictError);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("someone else\n");
    expect(engine.get(patch.id).status).toBe("conflicted");
  });

  it("rejects when the file was deleted after preview", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    rmSync(join(root, "a.txt"));
    const err = (() => {
      try {
        engine.apply(root, patch.id);
        return null;
      } catch (e) {
        return e as PatchConflictError;
      }
    })();
    expect(err).toBeInstanceOf(PatchConflictError);
    expect(err?.reason).toBe("deleted");
  });

  it("rejects when an EMPTY file was deleted (not silently recreated)", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "empty.txt", "new\n", "");
    rmSync(join(root, "empty.txt"));
    expect(() => engine.apply(root, patch.id)).toThrowError(
      expect.objectContaining({ name: "PatchConflictError", reason: "deleted" }),
    );
  });

  it("a second apply of the same patch id is a no-op conflict, not a rewrite", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    engine.apply(root, patch.id);
    // Disk now holds the NEW content, which differs from the original hash.
    expect(() => engine.apply(root, patch.id)).toThrow(PatchConflictError);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("new\n");
  });

  it("concurrent patches for one file: the loser conflicts, nothing interleaves", () => {
    const engine = new PatchEngine();
    const first = create(engine, "a.txt", "first\n", "old\n");
    const second = engine.create({ projectRoot: root, file: "a.txt", newContent: "second\n", origin: "manual" });
    engine.apply(root, first.id);
    expect(() => engine.apply(root, second.id)).toThrow(PatchConflictError);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("first\n");
  });

  it("unknown patch id throws PatchNotFoundError", () => {
    expect(() => new PatchEngine().apply(root, "patch_nope")).toThrow(PatchNotFoundError);
  });

  it("malformed patch content cannot reach apply (create-time schema rejects it at the route)", () => {
    // apply() only ever writes bytes stashed by create() on this same
    // instance, so there is no diff-string parsing step that could fail here.
    // The invalid-format rejection lives at POST /patch (400); assert the
    // engine never invents content: applying writes exactly what create saw.
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "exact bytes µ\n", "old\n");
    engine.apply(root, patch.id);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("exact bytes µ\n");
  });
});

describe("PatchEngine.apply — write failures (original untouched)", () => {
  it("target replaced by a directory surfaces PatchWriteError, not a 404-shaped error", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "f.txt", "new\n", "data\n");
    rmSync(join(root, "f.txt"));
    mkdirSync(join(root, "f.txt"));
    expect(() => engine.apply(root, patch.id)).toThrow(PatchWriteError);
    expect(statSync(join(root, "f.txt")).isDirectory()).toBe(true);
  });

  it("write errors never leak absolute paths", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "f.txt", "new\n", "data\n");
    rmSync(join(root, "f.txt"));
    mkdirSync(join(root, "f.txt"));
    try {
      engine.apply(root, patch.id);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(root);
    }
  });
});

describe("PatchEngine.apply — injected path guard (audit P4)", () => {
  it("uses the guard's canonical path for hashing AND writing", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    const seen: string[] = [];
    engine.apply(root, patch.id, {
      checkFile: (abs) => {
        seen.push(abs);
        return abs;
      },
    });
    expect(seen).toEqual([join(root, "a.txt")]);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("new\n");
  });

  it("a guard rejection aborts before any filesystem mutation", () => {
    const engine = new PatchEngine();
    const patch = create(engine, "a.txt", "new\n", "old\n");
    const refusal = new Error("Refused");
    refusal.name = "PathEscapeError";
    expect(() =>
      engine.apply(root, patch.id, {
        checkFile: () => {
          throw refusal;
        },
      }),
    ).toThrow(refusal);
    expect(readFileSync(join(root, "a.txt"), "utf-8")).toBe("old\n");
  });

  it("blocks a junction swapped in between preview and apply (hash-equal escape)", () => {
    const outside = join(base, "outside");
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(root, "sub"));
    // Same bytes inside and outside, so the hash check alone cannot save us.
    writeFileSync(join(root, "sub", "t.txt"), "same\n");
    writeFileSync(join(outside, "t.txt"), "same\n");

    const engine = new PatchEngine();
    const patch = engine.create({
      projectRoot: root,
      file: "sub/t.txt",
      newContent: "PWNED\n",
      origin: "manual",
    });
    rmSync(join(root, "sub"), { recursive: true });
    symlinkSync(outside, join(root, "sub"), "junction");

    // The guard resolves the junction and refuses; without it the write
    // would land outside the project root (reproduced pre-fix). This is a
    // minimal canonicalization guard standing in for the agent's
    // SecurityManager (which the route always injects — see P4).
    const guard = (abs: string): string => {
      const missing: string[] = [];
      let cur = abs;
      for (;;) {
        if (existsSync(cur)) {
          let real = realpathSync(cur);
          for (const seg of missing) real = join(real, seg);
          if (real !== root && !real.startsWith(root + "/") && !real.startsWith(root + "\\")) {
            throw new Error("Refused: escapes project root");
          }
          return real;
        }
        const parent = dirname(cur);
        if (parent === cur) throw new Error("Refused: escapes project root");
        missing.unshift(basename(cur));
        cur = parent;
      }
    };
    expect(() => engine.apply(root, patch.id, { checkFile: guard })).toThrow(/Refused/);
    expect(readFileSync(join(outside, "t.txt"), "utf-8")).toBe("same\n");
  });
});
