import { agentPost } from "../agentClient";
import type { SourcePatch } from "@devbridge/protocol";

/** `devbridge apply <patchId>` — the only command that writes to disk. */
export async function applyCommand(patchId: string) {
  try {
    const patch = await agentPost<SourcePatch>(`/patch/${patchId}/apply`);
    console.log(`Applied ${patch.id} -> ${patch.file}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
