import { Router } from "express";
import { z } from "zod";
import type { ProjectManager } from "../ProjectManager";

const CheckpointSchema = z.object({
  message: z.string().min(1),
  testsPassing: z.boolean().nullable(),
});

const RollbackSchema = z.object({ sha: z.string().min(1) });

export function gitRoutes(project: ProjectManager): Router {
  const router = Router();

  router.get("/git/diff", async (_req, res) => {
    res.json({ diff: await project.git.diff() });
  });

  router.get("/git/checkpoints", (_req, res) => {
    res.json(project.git.listCheckpoints());
  });

  router.get("/git/last-green", (_req, res) => {
    const lastGreen = project.git.lastGreen();
    if (!lastGreen) return res.status(404).json({ error: "no green checkpoint yet" });
    res.json(lastGreen);
  });

  router.post("/git/checkpoint", async (req, res) => {
    const parsed = CheckpointSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const cp = await project.git.checkpoint(parsed.data.message, parsed.data.testsPassing);
      res.status(201).json(cp);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Reversible rollback — creates a revert commit, never a destructive reset (section 40).
  router.post("/git/rollback", async (req, res) => {
    const parsed = RollbackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const cp = await project.git.rollbackTo(parsed.data.sha);
      res.status(201).json(cp);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
