import { agentPost } from "../agentClient";
import type { SourcePatch } from "@devbridge/protocol";

/** `devbridge preview <patchId>` — marks a patch previewed and prints its diff. */
export async function previewCommand(patchId: string) {
  const patch = await agentPost<SourcePatch>(`/patch/${patchId}/preview`);
  console.log(`Patch ${patch.id} (${patch.risk} risk)`);
  console.log(patch.riskReasons.map((r) => `  - ${r}`).join("\n"));
  console.log("\n" + patch.diff);
}
