import { Router } from "express";
import { z } from "zod";
import { DevIdentitySchema, MAX_BULK_IDENTITIES } from "@devbridge/protocol";
import type { ProjectManager } from "../ProjectManager";
import { PathEscapeError } from "../SecurityManager";
import type { EventBus } from "../ws/eventBus";

const BulkIdentitySchema = z.object({
  identities: z.array(DevIdentitySchema).max(MAX_BULK_IDENTITIES),
});

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
  //
  // All-or-nothing (audit A3): schema and size checks run first (no
  // filesystem work for malformed requests), then EVERY source file is
  // containment-checked against the canonical project root, and only then is
  // anything upserted. One escaping or malformed item rejects the whole
  // batch — a single poisoned `source.file` (traversal, symlink, junction,
  // absolute outside path) can never create a partial registry that later
  // feeds GET /source. Contract unchanged: 204 on success.
  router.post("/identity/bulk", (req, res) => {
    const parsed = BulkIdentitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const files = [...new Set(parsed.data.identities.map((i) => i.source.file))];
      for (const file of files) project.security.assertPathInProject(file);
    } catch (err) {
      if (err instanceof PathEscapeError) return res.status(403).json({ error: err.message });
      return res.status(400).json({ error: "invalid identity source file" });
    }

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
