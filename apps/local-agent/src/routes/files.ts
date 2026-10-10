import { readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { Router } from "express";
import type { ProjectManager } from "../ProjectManager";

/**
 * Files routes — the panel's Files view (project-relative source browsing).
 *
 * Safety contract (same choke point as every other filesystem route):
 *   - The walk never leaves the project root: it starts AT the canonical
 *     root and only descends into real directories. Symlinked entries are
 *     never followed, so a link inside the project cannot pull the listing
 *     (or a later /source read) outside it.
 *   - Excluded unconditionally: dot-directories/files (.git, .turbo, …),
 *     node_modules, build outputs (dist, build, out, coverage), and files
 *     whose extension is not an editable source type. This is a source
 *     browser, not a filesystem browser.
 *   - Read-only: no caller-controlled commands, no writes, no absolute
 *     paths in the response — project-relative POSIX paths only, which
 *     /source and /editor/open re-validate through assertPathInProject.
 *   - Bounded: at most MAX_FILES entries; beyond that the response sets
 *     `truncated: true` and the client says so instead of pretending the
 *     list is complete.
 */

export const MAX_FILES = 2000;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".turbo", ".next", ".vscode", "__pycache__"]);

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".scss", ".less",
  ".json", ".vue", ".svelte", ".html",
]);

export interface ProjectFileList {
  files: string[];
  truncated: boolean;
}

export function listProjectFiles(projectRoot: string, maxFiles: number = MAX_FILES): ProjectFileList {
  const files: string[] = [];
  let truncated = false;
  const stack: string[] = [projectRoot];

  const isFull = () => files.length >= maxFiles;

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip, never fail the listing
    }
    // Deterministic order so the panel list is stable across reloads.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (isFull()) {
        truncated = true;
        return { files, truncated };
      }
      const name = entry.name;
      if (name.startsWith(".")) continue; // dotfiles / dot-directories
      if (entry.isSymbolicLink()) continue; // never follow links (escape risk)
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        if (!SOURCE_EXTENSIONS.has(extname(name).toLowerCase())) continue;
        files.push(relative(projectRoot, abs).split(sep).join("/"));
      }
    }
  }
  files.sort();
  return { files, truncated };
}

export function filesRoutes(project: ProjectManager): Router {
  const router = Router();

  // GET /files — project-relative editable source paths for the Files view.
  router.get("/files", (_req, res) => {
    res.json(listProjectFiles(project.root));
  });

  return router;
}
