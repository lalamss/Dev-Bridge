/**
 * Source-resolution failure messages for the panel (Batch 6).
 *
 * Root cause it diagnoses: the local agent happily registers identities for
 * ANY project-relative path, resolved against ITS OWN root. When the agent
 * was started with the wrong `DEVBRIDGE_PROJECT_ROOT` (a stale agent, or
 * one started from another directory), `GET /identity/:id` returns 200
 * while `GET /source?file=` 404s — the old code reported this as
 * "Couldn't reach local agent", which is wrong (the agent IS reachable)
 * and sends the developer chasing the wrong problem. These pure helpers
 * pick the message that names the actual condition; App.tsx renders them.
 */

/** Identity lookup failed: nothing is registered under this id (yet). */
export function identityMissingMessage(devId: string): string {
  return (
    `No identity registered for ${devId} — the page hasn't sent its ` +
    `component map to the local agent yet. Make sure the agent is running ` +
    `and reload the page so the build plugin re-sends identities.`
  );
}

/**
 * Identity resolved but its file cannot be read. A 404 here almost always
 * means the agent's project root is not the inspected app (the classic
 * case: an agent started from another directory, or a leftover agent from
 * an earlier session). Any other status keeps the generic read error.
 */
export function sourceFailureMessage(devId: string, file: string, status: number): string {
  if (status === 404) {
    return (
      `The agent knows ${devId} (${file}) but has no such file. ` +
      `Its project root is probably not the inspected app — restart it ` +
      `with DEVBRIDGE_PROJECT_ROOT set to the app directory, then reload ` +
      `the page so identities re-sync.`
    );
  }
  return `Could not read ${file} from the local agent (status ${status}).`;
}
