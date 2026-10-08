import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { applyPatch as applyUnifiedDiff, createTwoFilesPatch } from "diff"; // diff@7 ships no types; declared in ./diff.d.ts
import type { PatchOrigin, RiskLevel, SourcePatch } from "@devbridge/protocol";
import { hashContent } from "@devbridge/source-mapper";
import { assessRisk, type RiskInput } from "./risk.js";

export class PatchConflictError extends Error {
  constructor(
    public file: string,
    public reason: "changed" | "deleted",
  ) {
    super(
      reason === "deleted"
        ? `Patch conflict: ${file} was deleted after the patch was proposed.`
        : `Patch conflict: ${file} has changed on disk since the patch was proposed.`,
    );
    this.name = "PatchConflictError";
  }
}

export class PatchNotFoundError extends Error {
  constructor(public patchId: string) {
    super(`No patch with id ${patchId} (unknown id, or the agent restarted and lost its in-memory proposals).`);
    this.name = "PatchNotFoundError";
  }
}

/**
 * Anything that goes wrong while the bytes are actually being written:
 * unreadable target, failed temp write, failed rename. The message carries
 * only the project-relative file — never an absolute path (section 5: error
 * reporting must not leak filesystem details).
 */
export class PatchWriteError extends Error {
  constructor(public file: string) {
    super(`Could not write ${file}: the original file was left unchanged.`);
    this.name = "PatchWriteError";
  }
}

export interface CreatePatchArgs {
  projectRoot: string;
  file: string; // project-relative
  newContent: string;
  origin: PatchOrigin;
  devId?: string;
  riskInput?: Partial<RiskInput>;
}

/**
 * PatchEngine — architecture doc section 13:
 *   DOM selection -> Source -> Edit -> Patch -> Diff -> Preview -> Apply
 *
 * Never writes to disk on `create()`. A patch is a structured, reviewable
 * object (unified diff + risk assessment) until `apply()` is explicitly
 * called, and `apply()` re-hashes the file first — if it has changed since
 * the patch was proposed, we refuse to overwrite (section 54: "If the hash
 * changed: CONFLICT. Never overwrite automatically.").
 */
export class PatchEngine {
  private patches = new Map<string, SourcePatch>();
  private checkpoints = new Map<string, { file: string; content: string; existed: boolean }>();
  private tmpCounter = 0;

  create(args: CreatePatchArgs): SourcePatch {
    const absPath = join(args.projectRoot, args.file);
    const original = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "";
    const originalHash = hashContent(original);

    const diff = createTwoFilesPatch(args.file, args.file, original, args.newContent, "before", "after");

    const risk = assessRisk({
      file: args.file,
      fanIn: args.riskInput?.fanIn ?? 0,
      touchesPublicApi: args.riskInput?.touchesPublicApi ?? false,
      touchesSharedToken: args.riskInput?.touchesSharedToken ?? args.file.includes("tokens"),
      touchesLogic: args.riskInput?.touchesLogic ?? false,
      testsAffected: args.riskInput?.testsAffected ?? 0,
    });

    const patch: SourcePatch = {
      id: `patch_${randomUUID().slice(0, 8)}`,
      file: args.file,
      originalHash,
      diff,
      origin: args.origin,
      status: "proposed",
      risk: risk.level,
      riskReasons: risk.reasons,
      devId: args.devId,
      createdAt: new Date().toISOString(),
    };

    this.patches.set(patch.id, patch);
    // Stash full "after" content so preview/apply don't need to re-derive it
    // from the diff (keeps this implementation simple and auditable), plus
    // whether the file existed: an empty file and a missing file have the
    // same hash, so without this flag a file deleted after preview would be
    // silently recreated instead of conflicting.
    this.checkpoints.set(patch.id, {
      file: args.file,
      content: args.newContent,
      existed: existsSync(absPath),
    });
    return patch;
  }

  get(patchId: string): SourcePatch {
    const patch = this.patches.get(patchId);
    if (!patch) throw new PatchNotFoundError(patchId);
    return patch;
  }

  list(): SourcePatch[] {
    return [...this.patches.values()];
  }

  /** Marks a patch as previewed — the review UI calls this once the visual/diff preview has been shown. */
  markPreviewed(patchId: string): SourcePatch {
    const patch = this.get(patchId);
    patch.status = "previewed";
    return patch;
  }

  markApproved(patchId: string): SourcePatch {
    const patch = this.get(patchId);
    patch.status = "approved";
    return patch;
  }

  reject(patchId: string): SourcePatch {
    const patch = this.get(patchId);
    patch.status = "rejected";
    return patch;
  }

  /**
   * Apply a patch to disk. Always re-checks the file hash first (section 54).
   *
   * `checkFile(absPath)` is the injected path guard documented here since the
   * audit (P4): the local agent passes
   * `SecurityManager.assertPathInProject`, which canonicalizes symlinks and
   * junctions BEFORE the hash is read and returns the canonical path that
   * every filesystem operation below must use. Without it, a path swapped
   * for a symlink/junction between preview and apply would hash AND write
   * through to outside the project root. Callers that skip the guard get the
   * legacy `join()` behavior — the HTTP route never skips it.
   *
   * Write protocol (all-or-nothing within this process):
   *   1. validate (guard, existence, hash) — no filesystem mutation yet;
   *   2. render the final content (already stashed at create time);
   *   3. fsync it to a temp file in the SAME directory (same volume, so the
   *      rename below cannot silently become a copy);
   *   4. atomically rename over the target; delete the temp file on any
   *      failure. The original is untouched until step 4.
   *
   * The whole body is synchronous, so concurrent patch requests in this
   * process cannot interleave between the hash check and the rename — the
   * second of two racing applies sees the first one's bytes and conflicts.
   * Cross-process races (two agents on one tree) are NOT protected; neither
   * is a power loss between fsync and rename (the temp file may linger and
   * is ignored on the next run). Windows: `renameSync` replaces the target
   * via MoveFileEx, so replacement is atomic at the filesystem level on the
   * same NTFS volume; file modes are preserved from the original.
   */
  apply(
    projectRoot: string,
    patchId: string,
    options: { checkFile?: (absPath: string) => string } = {},
  ): SourcePatch {
    const patch = this.get(patchId);
    const requested = join(projectRoot, patch.file);
    const absPath = options.checkFile ? options.checkFile(requested) : requested;

    const checkpoint = this.checkpoints.get(patchId);
    if (!checkpoint) throw new PatchNotFoundError(patchId);

    // Read the CURRENT bytes through the canonical path. Any read failure
    // other than "missing" (permissions, is-a-directory, vanishing
    // symlink loop) is a write failure, not a 404 and not a conflict.
    let current: string | null;
    try {
      current = existsSync(absPath) ? readFileSync(absPath, "utf-8") : null;
    } catch {
      throw new PatchWriteError(patch.file);
    }

    if (current === null) {
      // Missing now. A patch proposed against an existing file must not
      // resurrect it — not even an empty one (same hash as missing).
      if (checkpoint.existed) {
        patch.status = "conflicted";
        throw new PatchConflictError(patch.file, "deleted");
      }
    } else if (hashContent(current) !== patch.originalHash) {
      patch.status = "conflicted";
      throw new PatchConflictError(patch.file, "changed");
    }

    this.writeAtomically(absPath, patch.file, checkpoint.content);

    patch.status = "applied";
    return patch;
  }

  /**
   * Temp-file + fsync + rename. Throws PatchWriteError (original untouched)
   * on any failure and removes the temp file best-effort.
   */
  private writeAtomically(absPath: string, relFile: string, content: string): void {
    const dir = dirname(absPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      throw new PatchWriteError(relFile);
    }

    let mode: number | undefined;
    try {
      if (existsSync(absPath)) mode = statSync(absPath).mode & 0o777;
    } catch {
      // Mode is best-effort; the write below still decides success.
    }

    this.tmpCounter += 1;
    const tmpPath = join(dir, `.${basename(absPath)}.devbridge-${process.pid}-${this.tmpCounter}.tmp`);
    let fd: number | null = null;
    let wrote = false;
    try {
      fd = openSync(tmpPath, "w", mode ?? 0o666);
      writeFileSync(fd, content, "utf-8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmpPath, absPath);
      wrote = true;
    } catch {
      throw new PatchWriteError(relFile);
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* already broken; unlink below */
        }
      }
      if (!wrote) {
        try {
          unlinkSync(tmpPath);
        } catch {
          /* temp already gone — nothing to clean */
        }
      }
    }
  }

  /** Recompute a diff against the file's *current* on-disk content — used by `devbridge diff`. */
  diffAgainstDisk(
    projectRoot: string,
    patchId: string,
    options: { checkFile?: (absPath: string) => string } = {},
  ): string {
    const patch = this.get(patchId);
    const requested = join(projectRoot, patch.file);
    const absPath = options.checkFile ? options.checkFile(requested) : requested;
    const current = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "";
    const checkpoint = this.checkpoints.get(patchId);
    return createTwoFilesPatch(patch.file, patch.file, current, checkpoint?.content ?? "", "disk", "patch");
  }
}

// Re-exported for callers that want to apply a raw unified diff string
// directly (e.g. AI-proposed patches expressed as diffs rather than full
// file content).
export { applyUnifiedDiff };
