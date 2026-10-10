import { spawn } from "node:child_process";
import { Router } from "express";
import { OpenSourceRequestSchema } from "@devbridge/protocol";
import type { ProjectManager } from "../ProjectManager";
import { PathEscapeError } from "../SecurityManager";

/**
 * Editor routes — the local-machine side of browser -> source (and the
 * VS Code target of the reference workflow).
 *
 * The Chrome extension cannot launch local applications, so opening an
 * editor is a local-agent operation. The safety contract:
 *
 *   - The request is bound to THIS agent's project: `projectId` must equal
 *     the agent's own project id, so a request meant for Project A is never
 *     honored by Project B's agent (409).
 *   - `file` goes through the same `assertPathInProject` containment every
 *     other filesystem route uses — traversal and symlink escapes are 403.
 *   - No caller-controlled commands: argv is always exactly
 *     `code -g <abs>:<line>:<col>` with `shell: false`. There is no generic
 *     command-execution API here.
 *   - When the `code` CLI is missing, the route answers 503 with an
 *     actionable message instead of failing obscurely.
 */

/** Opens `<abs>:<line>:<col>` in VS Code. Injected in tests. */
export type EditorOpener = (absPath: string, line: number, column: number) => Promise<void>;

const CODE_TIMEOUT_MS = 15000;

export function defaultEditorOpener(absPath: string, line: number, column: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = `${absPath}:${line}:${column}`;
    let child;
    try {
      child = spawn("code", ["-g", target], { shell: false, timeout: CODE_TIMEOUT_MS });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new EditorUnavailableError(
            "VS Code CLI (`code`) not found on PATH. Install it via VS Code's “Shell Command: Install 'code' command in PATH”, then retry.",
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`VS Code exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ""}`));
    });
  });
}

export class EditorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorUnavailableError";
  }
}

export function editorRoutes(project: ProjectManager, opener: EditorOpener = defaultEditorOpener): Router {
  const router = Router();

  // POST /editor/open { projectId, file, line, column } — open a project
  // file in VS Code at the requested position.
  router.post("/editor/open", async (req, res) => {
    const parsed = OpenSourceRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { projectId, file, line, column } = parsed.data;

    const info = await project.info();
    if (projectId !== info.id) {
      return res.status(409).json({
        error: `Request is for project "${projectId}" but this agent serves "${info.id}".`,
      });
    }

    let absPath: string;
    try {
      absPath = project.security.assertPathInProject(file);
    } catch (err) {
      if (err instanceof PathEscapeError) return res.status(403).json({ error: err.message });
      return res.status(400).json({ error: "invalid file" });
    }

    try {
      await opener(absPath, line, column);
    } catch (err) {
      if (err instanceof EditorUnavailableError) return res.status(503).json({ error: err.message });
      return res.status(500).json({ error: err instanceof Error ? err.message : "editor open failed" });
    }
    res.json({ ok: true, file, line, column });
  });

  return router;
}
