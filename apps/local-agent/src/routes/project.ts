import { Router } from "express";
import { z } from "zod";
import { DevIdentitySchema, DevServerReportSchema, MAX_BULK_IDENTITIES } from "@devbridge/protocol";
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

  // POST /project/dev-server { url } — the build plugin reports the origin
  // serving the instrumented app, so the panel can match an inspected page to
  // THIS project (Phase 5: project detection). Two-project disambiguation
  // ("A on :5173" vs "B on :3000") works because each single-project agent
  // reports its own origin and the panel additionally requires identity
  // resolution to succeed before offering source operations.
  //
  // Handshake semantics: only a non-browser client may report. Browsers
  // always send an Origin header on POST; the Vite plugin's fetch sends
  // none. A random webpage therefore cannot claim "I am this project" —
  // and even a loopback page cannot register a non-loopback origin.
  router.post("/project/dev-server", (req, res) => {
    if (req.get("origin")) {
      return res.status(403).json({ error: "dev-server origin may only be reported by the local build process" });
    }
    const parsed = DevServerReportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    let origin: string;
    try {
      const u = new URL(parsed.data.url);
      if (u.protocol !== "http:") throw new Error("not http");
      if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new Error("not loopback");
      origin = u.origin;
    } catch {
      return res.status(400).json({ error: "url must be a loopback http origin (http://localhost:<port>)" });
    }
    project.setDevServerUrl(origin);
    res.json({ ok: true, devServerUrl: origin });
  });

  return router;
}
