import { Router } from "express";
import { z } from "zod";
import { DevIdentitySchema } from "@devbridge/protocol";
import type { ProjectManager } from "../ProjectManager";
import type { EventBus } from "../ws/eventBus";

const BulkIdentitySchema = z.object({ identities: z.array(DevIdentitySchema) });

export function projectRoutes(project: ProjectManager, events: EventBus): Router {
  const router = Router();

  // GET /project — architecture doc section 47 (`devbridge status`)
  router.get("/project", async (_req, res) => {
    res.json(await project.info());
  });

  // GET /identity/:id — resolve a single Dev Identity (section 6)
  router.get("/identity/:id", (req, res) => {
    const identity = project.identities.get(req.params.id);
    if (!identity) return res.status(404).json({ error: "not found" });
    res.json(identity);
  });

  // POST /identity/bulk — called by the Vite plugin on every transform (plugins/vite/src/index.ts)
  router.post("/identity/bulk", (req, res) => {
    const parsed = BulkIdentitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    project.identities.upsertMany(parsed.data.identities);
    events.broadcast("file.changed", {
      files: [...new Set(parsed.data.identities.map((i) => i.source.file))],
    });
    res.status(204).end();
  });

  // GET /identity?file=... — component tree / inspector for one file (section 10)
  router.get("/identities", (req, res) => {
    const file = typeof req.query.file === "string" ? req.query.file : undefined;
    res.json(file ? project.identities.forFile(file) : project.identities.all());
  });

  return router;
}
