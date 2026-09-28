import { readFileSync } from "node:fs";
import { Router } from "express";
import type { ProjectManager } from "../ProjectManager";
import { PathEscapeError } from "../SecurityManager";

export function sourceRoutes(project: ProjectManager): Router {
  const router = Router();

  // GET /source?file=src/components/Button.tsx — Monaco editor loads this (section 12)
  router.get("/source", (req, res) => {
    const file = req.query.file;
    if (typeof file !== "string") return res.status(400).json({ error: "file query param required" });

    try {
      const absPath = project.security.assertPathInProject(file);
      const content = readFileSync(absPath, "utf-8");
      res.json({ file, content });
    } catch (err) {
      if (err instanceof PathEscapeError) return res.status(403).json({ error: err.message });
      res.status(404).json({ error: "file not found" });
    }
  });

  return router;
}
