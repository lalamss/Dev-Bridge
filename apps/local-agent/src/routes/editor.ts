import { statSync } from "node:fs";
import { Router } from "express";
import { OpenSourceRequestSchema, type VSCodeStatus } from "@devbridge/protocol";
import type { ProjectManager } from "../ProjectManager";
import { PathEscapeError } from "../SecurityManager";
import {
  EditorUnavailableError,
  openFileInVSCode,
  refreshVSCodeDiscovery,
  resolveVSCodeExecutable,
  VSCodeNotInstalledError,
  type VSCodeInstall,
} from "../vscode";

export { EditorUnavailableError };

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
 *     other filesystem route uses — traversal and symlink escapes are 403 —
 *     and must exist as a regular file (404 otherwise, so VS Code never
 *     opens a phantom untitled tab for a moved/deleted path).
 *   - No caller-controlled commands: the launcher is resolved by DevBridge's
 *     own VS Code discovery and argv is always exactly
 *     `<exe> --goto <abs>:<line>:<col>` with no shell string. There is no
 *     generic command-execution API here.
 *   - When no usable VS Code is found, the route answers 503 with a
 *     diagnostic message (install vs. launch failures stay distinct).
 */

/** Opens `<abs>:<line>:<col>` in VS Code. Injected in tests. */
export type EditorOpener = (absPath: string, line: number, column: number) => Promise<void>;

export function defaultEditorOpener(absPath: string, line: number, column: number): Promise<void> {
  return openFileInVSCode(absPath, line, column).then(() => undefined);
}

export function editorRoutes(
  project: ProjectManager,
  opener: EditorOpener = defaultEditorOpener,
  detect: () => Promise<VSCodeInstall> = resolveVSCodeExecutable,
): Router {
  const router = Router();

  // GET /editor/vscode[?refresh=1] — installation detection status for the
  // panel's install dialog. `refresh=1` clears cached discovery first, so a
  // VS Code installed after the agent started is found even though the
  // agent's own PATH never changed. Never exposes executable paths.
  router.get("/editor/vscode", async (req, res) => {
    if (req.query.refresh === "1") refreshVSCodeDiscovery();
    try {
      const install = await detect();
      const body: VSCodeStatus = { ok: true, found: true, via: install.via };
      return res.json(body);
    } catch (err) {
      if (err instanceof EditorUnavailableError) {
        const body: VSCodeStatus = { ok: false, found: false, error: err.message };
        return res.status(503).json(body);
      }
      const body: VSCodeStatus = {
        ok: false,
        found: false,
        error: err instanceof Error ? err.message : "VS Code detection failed.",
      };
      return res.status(500).json(body);
    }
  });

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

    let isFile = false;
    try {
      isFile = statSync(absPath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      return res.status(404).json({
        error: `File not found in the project: "${file}". It may have been moved, renamed, or deleted.`,
      });
    }

    try {
      await opener(absPath, line, column);
    } catch (err) {
      // Discovery vs launch stay distinct on the wire: only "not installed"
      // is 503/not-installed (install dialog); a present-but-unlaunchable
      // VS Code is 503/launch-failed (retry dialog) or 500, never "not found".
      if (err instanceof VSCodeNotInstalledError) {
        return res.status(503).json({ error: err.message, code: "not-installed" });
      }
      if (err instanceof EditorUnavailableError) {
        return res.status(503).json({ error: err.message, code: "launch-failed" });
      }
      return res.status(500).json({ error: err instanceof Error ? err.message : "editor open failed" });
    }
    res.json({ ok: true, file, line, column });
  });

  return router;
}
