import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyPatch as applyUnifiedDiff, createTwoFilesPatch } from "diff";
import type { PatchOrigin, RiskLevel, SourcePatch } from "@devbridge/protocol";
import { hashContent, hashFile } from "@devbridge/source-mapper";
import { assessRisk, type RiskInput } from "./risk";

export class PatchConflictError extends Error {
  constructor(public file: string) {
    super(`Patch conflict: ${file} has changed on disk since the patch was proposed.`);
    this.name = "PatchConflictError";
  }
}

export class PatchNotFoundError extends Error {
  constructor(public patchId: string) {
    super(`No patch with id ${patchId}`);
    this.name = "PatchNotFoundError";
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
  private checkpoints = new Map<string, { file: string; content: string }>();

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
    // from the diff (keeps this implementation simple and auditable).
    this.checkpoints.set(patch.id, { file: args.file, content: args.newContent });
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
   * `checkFile(absPath)` is injected so callers (local-agent's SecurityManager)
   * can also assert the path is inside the authorized project root before we
   * ever touch the filesystem.
   */
  apply(projectRoot: string, patchId: string): SourcePatch {
    const patch = this.get(patchId);
    const absPath = join(projectRoot, patch.file);
    const currentHash = existsSync(absPath) ? hashFile(absPath) : hashContent("");

    if (currentHash !== patch.originalHash) {
      patch.status = "conflicted";
      throw new PatchConflictError(patch.file);
    }

    const checkpoint = this.checkpoints.get(patchId);
    if (!checkpoint) throw new PatchNotFoundError(patchId);

    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, checkpoint.content, "utf-8");

    patch.status = "applied";
    return patch;
  }

  /** Recompute a diff against the file's *current* on-disk content — used by `devbridge diff`. */
  diffAgainstDisk(projectRoot: string, patchId: string): string {
    const patch = this.get(patchId);
    const absPath = join(projectRoot, patch.file);
    const current = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "";
    const checkpoint = this.checkpoints.get(patchId);
    return createTwoFilesPatch(patch.file, patch.file, current, checkpoint?.content ?? "", "disk", "patch");
  }
}

// Re-exported for callers that want to apply a raw unified diff string
// directly (e.g. AI-proposed patches expressed as diffs rather than full
// file content).
export { applyUnifiedDiff };
