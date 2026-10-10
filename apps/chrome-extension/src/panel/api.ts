/**
 * Agent HTTP client for the panel.
 *
 * Thin wrappers over the existing local-agent protocol (GET /project,
 * /identity, /identities, /source, /files, /state, /patch*, /git/*,
 * /editor/open). All functions take an explicit `fetchImpl` so they are
 * unit-testable in Node without a browser; App.tsx passes the global fetch.
 *
 * Nothing here invents data: failures throw Errors with actionable,
 * status-specific messages and the views render them as-is.
 */

import type {
  AgentProject,
  DevIdentity,
  GitCheckpoint,
  ProjectFileList,
  SourcePatch,
  StateSnapshot,
} from "./theme";

export const AGENT = "http://localhost:4577";
export const AGENT_WS = "ws://localhost:4577/events";

type FetchImpl = typeof fetch;

async function readAgentError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    /* non-JSON error body — use the fallback */
  }
  return fallback;
}

export function networkError(e: unknown): Error {
  if (e instanceof TypeError) {
    return new Error("Local agent unavailable — is `devbridge start` running on http://localhost:4577?");
  }
  return e as Error;
}

export async function getProject(fetchImpl: FetchImpl = fetch): Promise<AgentProject> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/project`);
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw new Error(`GET /project -> ${res.status}`);
  return (await res.json()) as AgentProject;
}

export async function getIdentities(fetchImpl: FetchImpl = fetch, file?: string): Promise<DevIdentity[]> {
  const url = file ? `${AGENT}/identities?file=${encodeURIComponent(file)}` : `${AGENT}/identities`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw new Error(`Identity lookup failed (agent said ${res.status}).`);
  return (await res.json()) as DevIdentity[];
}

export async function getIdentity(devId: string, fetchImpl: FetchImpl = fetch): Promise<DevIdentity | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/identity/${devId}`);
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /identity -> ${res.status}`);
  return (await res.json()) as DevIdentity;
}

export async function getSource(file: string, fetchImpl: FetchImpl = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/source?file=${encodeURIComponent(file)}`);
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw new Error(`GET /source -> ${res.status}`);
  const d = (await res.json()) as { content?: string };
  return d.content ?? "";
}

export async function getFiles(fetchImpl: FetchImpl = fetch): Promise<ProjectFileList> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/files`);
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 404) {
    throw new Error("This agent does not serve GET /files — restart it from a DevBridge build that includes the Files route.");
  }
  if (!res.ok) throw new Error(`File listing failed (agent said ${res.status}).`);
  const d = (await res.json()) as ProjectFileList;
  return { files: Array.isArray(d.files) ? d.files : [], truncated: Boolean(d.truncated) };
}

export async function getStateSnapshot(devId: string, fetchImpl: FetchImpl = fetch): Promise<StateSnapshot | null> {
  try {
    const r = await fetchImpl(`${AGENT}/state/${devId}`);
    if (!r.ok) return null;
    return (await r.json()) as StateSnapshot;
  } catch {
    return null;
  }
}

export interface CreatePatchArgs {
  file: string;
  newContent: string;
  devId: string | null;
}

export async function createPatch(args: CreatePatchArgs, fetchImpl: FetchImpl = fetch): Promise<SourcePatch> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: args.file, newContent: args.newContent, origin: "manual", devId: args.devId }),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 403) throw new Error(await readAgentError(res, "Refused: this file is outside the authorized project root."));
  if (res.status === 400) throw new Error(await readAgentError(res, "Invalid patch request — the file or content was rejected by the agent."));
  if (!res.ok) throw new Error(await readAgentError(res, `Patch proposal failed (agent said ${res.status}).`));
  return (await res.json()) as SourcePatch;
}

export async function previewPatch(patchId: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  await fetchImpl(`${AGENT}/patch/${patchId}/preview`, { method: "POST" });
}

export async function approveAndApply(patchId: string, fetchImpl: FetchImpl = fetch): Promise<SourcePatch> {
  let approveRes: Response;
  try {
    approveRes = await fetchImpl(`${AGENT}/patch/${patchId}/approve`, { method: "POST" });
  } catch (e) {
    throw networkError(e);
  }
  if (approveRes.status === 404) throw new Error("Patch no longer exists on the agent (did it restart?). Re-select the element to propose again.");
  if (!approveRes.ok) throw new Error(await readAgentError(approveRes, `Approve failed (agent said ${approveRes.status}). Nothing was written.`));

  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/patch/${patchId}/apply`, { method: "POST" });
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 409) {
    let reason = "";
    try {
      const body = await res.json();
      reason = body?.reason === "deleted"
        ? "The source file was deleted after the preview — nothing was written. "
        : "The source file changed on disk since the preview — nothing was written. ";
    } catch {
      /* fall through with the generic conflict text */
    }
    throw new Error(`${reason}Re-select the element to reload and propose again.`);
  }
  if (res.status === 404) throw new Error("Patch no longer exists on the agent (did it restart?). Re-select the element to propose again.");
  if (res.status === 403) throw new Error(await readAgentError(res, "Refused: this file is outside the authorized project root. Nothing was written."));
  if (res.status === 500) throw new Error(await readAgentError(res, "The agent could not write the file (disk or permissions). Nothing was written."));
  if (!res.ok) throw new Error(await readAgentError(res, `Apply failed (agent said ${res.status}). Nothing was written.`));
  const applied = (await res.json()) as SourcePatch;
  if (applied.status !== "applied") throw new Error("Agent returned without confirming the write — treating as failed. Nothing is assumed about the file.");
  return applied;
}

export async function rejectPatch(patchId: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  await fetchImpl(`${AGENT}/patch/${patchId}/reject`, { method: "POST" });
}

export async function createCheckpoint(message: string, fetchImpl: FetchImpl = fetch): Promise<GitCheckpoint | null> {
  const cpRes = await fetchImpl(`${AGENT}/git/checkpoint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, testsPassing: null }),
  });
  if (!cpRes.ok) return null;
  return (await cpRes.json()) as GitCheckpoint;
}

export async function rollbackCheckpoint(sha: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  const res = await fetchImpl(`${AGENT}/git/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export interface OpenInEditorArgs {
  projectId: string;
  file: string;
  line: number;
  column: number;
}

export async function openInEditor(args: OpenInEditorArgs, fetchImpl: FetchImpl = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${AGENT}/editor/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (res.status === 409) throw new Error("This agent serves a different project — run `devbridge start` in the matching project.");
  if (res.status === 403) throw new Error("Refused: this file is outside the authorized project root.");
  if (res.status === 503) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* fall through */
    }
    throw new Error(detail || "VS Code CLI (`code`) not found on PATH.");
  }
  if (!res.ok) throw new Error(`Open in VS Code failed (agent said ${res.status}).`);
}
