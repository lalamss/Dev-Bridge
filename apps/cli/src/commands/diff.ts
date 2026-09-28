import { agentGet } from "../agentClient";

/** `devbridge diff` — working tree diff via GitManager. */
export async function diffCommand() {
  const { diff } = await agentGet<{ diff: string }>("/git/diff");
  console.log(diff || "(no changes)");
}
