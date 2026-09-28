import { agentGet, isAgentUnreachable } from "../agentClient";
import type { ProjectInfo } from "@devbridge/protocol";

/** `devbridge status` — section 47 example output. */
export async function statusCommand() {
  try {
    const info = await agentGet<ProjectInfo>("/project");
    console.log(`Project: ${info.root}`);
    console.log(`Framework: ${info.framework}`);
    console.log(`Git: ${info.gitClean ? "clean" : "dirty"}`);
    console.log(`Dev server: ${info.devServerUrl ?? "not set"}`);
    console.log(`Test command: ${info.testCommand ?? "none detected"}`);
  } catch (err) {
    if (isAgentUnreachable(err)) {
      console.error("No local agent running. Run `devbridge start` first.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
