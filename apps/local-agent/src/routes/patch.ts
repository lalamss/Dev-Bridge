import { Router } from "express";
import { z } from "zod";
import {
  MAX_DEVID_LENGTH,
  MAX_PATH_LENGTH,
} from "@devbridge/protocol";
import type { ProjectManager } from "../ProjectManager";
import { PatchConflictError, PatchNotFoundError, PatchWriteError } from "@devbridge/patch-engine";
import { PathEscapeError, AIPermissionDeniedError } from "../SecurityManager";
import type { EventBus } from "../ws/eventBus";

/** Largest single file the agent will accept for a patch (express allows 5mb of JSON). */
const MAX_PATCH_BYTES = 2 * 1024 * 1024;

const CreatePatchSchema = z.object({
  file: z.string().min(1).max(MAX_PATH_LENGTH),
  newContent: z.string().max(MAX_PATCH_BYTES),
  origin: z.enum(["manual", "ai", "token-sync"]),
  devId: z.string().max(MAX_DEVID_LENGTH).optional(),
  aiCategory: z.enum(["styling", "accessibility", "tests", "logic", "backend", "dependencies"]).optional(),
  riskInput: z
    .object({
      fanIn: z.number().optional(),
      touchesPublicApi: z.boolean().optional(),
      touchesSharedToken: z.boolean().optional(),
      touchesLogic: z.boolean().optional(),
      testsAffected: z.number().optional(),
    })
    .optional(),
});

export function patchRoutes(project: ProjectManager, events: EventBus): Router {
  const router = Router();

  // POST /patch — propose a patch. Never writes to disk (section 13).
  router.post("/patch", (req, res) => {
    const parsed = CreatePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const body = parsed.data;

    try {
      project.security.assertPathInProject(body.file);

      if (body.origin === "ai") {
        // Section 42: the patch engine — not the model — enforces AI permissions.
        project.security.assertAIAllowed(body.aiCategory ?? "logic");
      }

      const patch = project.patches.create({
        projectRoot: project.root,
        file: body.file,
        newContent: body.newContent,
        origin: body.origin,
        devId: body.devId,
        riskInput: body.riskInput,
      });

      events.broadcast("patch.created", patch);
      res.status(201).json(patch);
    } catch (err) {
      if (err instanceof PathEscapeError) return res.status(403).json({ error: err.message });
      if (err instanceof AIPermissionDeniedError) return res.status(403).json({ error: err.message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/patch/:id", (req, res) => {
    try {
      res.json(project.patches.get(req.params.id));
    } catch {
      res.status(404).json({ error: "patch not found" });
    }
  });

  router.get("/patches", (_req, res) => {
    res.json(project.patches.list());
  });

  // GET /patch/:id/diff — recompute against current disk state (section 13: "Diff")
  router.get("/patch/:id/diff", (req, res) => {
    try {
      res.json({
        diff: project.patches.diffAgainstDisk(project.root, req.params.id, {
          checkFile: (abs) => project.security.assertPathInProject(abs),
        }),
      });
    } catch (err) {
      if (err instanceof PatchNotFoundError) return res.status(404).json({ error: "patch not found" });
      if (err instanceof PathEscapeError) return res.status(403).json({ error: (err as Error).message });
      res.status(500).json({ error: "could not read the current file" });
    }
  });

  router.post("/patch/:id/preview", (req, res) => {
    try {
      res.json(project.patches.markPreviewed(req.params.id));
    } catch {
      res.status(404).json({ error: "patch not found" });
    }
  });

  router.post("/patch/:id/approve", (req, res) => {
    try {
      res.json(project.patches.markApproved(req.params.id));
    } catch {
      res.status(404).json({ error: "patch not found" });
    }
  });

  router.post("/patch/:id/reject", (req, res) => {
    try {
      res.json(project.patches.reject(req.params.id));
    } catch {
      res.status(404).json({ error: "patch not found" });
    }
  });

  // POST /patch/:id/apply — the only route that ever writes to disk.
  // Status contract (the panel distinguishes all of these):
  //   200 patch applied; 409 source changed/deleted since preview;
  //   404 unknown id (or agent restarted and lost in-memory proposals);
  //   403 path escapes the project root; 500 write/replacement failure.
  router.post("/patch/:id/apply", (req, res) => {
    try {
      const patch = project.patches.apply(project.root, req.params.id, {
        // P4: the canonical guard runs inside apply(), on the exact path
        // that is hashed and written — a symlink/junction swapped in after
        // preview is refused here, not followed.
        checkFile: (abs) => project.security.assertPathInProject(abs),
      });
      events.broadcast("patch.applied", patch);
      events.broadcast("file.changed", { files: [patch.file] });
      res.json(patch);
    } catch (err) {
      if (err instanceof PatchConflictError) {
        return res.status(409).json({ error: err.message, status: "conflicted", reason: err.reason });
      }
      if (err instanceof PatchNotFoundError) {
        return res.status(404).json({ error: "patch not found" });
      }
      if (err instanceof PathEscapeError) {
        return res.status(403).json({ error: (err as Error).message });
      }
      if (err instanceof PatchWriteError) {
        // Sanitized by construction: PatchWriteError carries only the
        // project-relative file, never an absolute path.
        return res.status(500).json({ error: (err as Error).message, code: "write-failed" });
      }
      res.status(500).json({ error: "patch apply failed" });
    }
  });

  return router;
}
