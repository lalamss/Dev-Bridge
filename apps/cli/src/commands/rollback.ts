import { agentGet, agentPost } from "../agentClient";
import type { GitCheckpoint } from "@devbridge/protocol";

/** `devbridge rollback` — revert to the last checkpoint whose tests passed (section 40). */
export async function rollbackCommand() {
  const lastGreen = await agentGet<GitCheckpoint>("/git/last-green");
  const result = await agentPost<GitCheckpoint>("/git/rollback", { sha: lastGreen.sha });
  console.log(`Rolled back to ${lastGreen.sha.slice(0, 7)} via new commit ${result.sha.slice(0, 7)}`);
}
