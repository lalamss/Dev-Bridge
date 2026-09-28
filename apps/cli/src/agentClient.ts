const AGENT_URL = process.env.DEVBRIDGE_AGENT_URL ?? "http://localhost:4577";

export async function agentGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function agentPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AGENT_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function isAgentUnreachable(err: unknown): boolean {
  return err instanceof TypeError; // fetch throws TypeError on connection refused
}
