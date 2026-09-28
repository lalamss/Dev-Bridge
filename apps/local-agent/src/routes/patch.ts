import { Router } from "express";
import { z } from "zod";
import type { ProjectManager } from "../ProjectManager";
import { PatchConflictError } from "@devbridge/patch-engine";
import { PathEscapeError, AIPermissionDeniedError } from "../SecurityManager";
import type { EventBus } from "../ws/eventBus";

const CreatePatchSchema = z.object({
  file: z.string().min(1),
  newContent: z.string(),
  origin: z.enum(["manual", "ai", "token-sync"]),
  devId: z.string().optional(),
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
      res.json({ diff: project.patches.diffAgainstDisk(project.root, req.params.id) });
    } catch {
      res.status(404).json({ error: "patch not found" });
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
  router.post("/patch/:id/apply", (req, res) => {
    try {
      const patch = project.patches.apply(project.root, req.params.id);
      events.broadcast("patch.applied", patch);
      events.broadcast("file.changed", { files: [patch.file] });
      res.json(patch);
    } catch (err) {
      if (err instanceof PatchConflictError) {
        return res.status(409).json({ error: err.message, status: "conflicted" });
      }
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return router;
}
