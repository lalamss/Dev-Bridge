import { spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * `devbridge start [dir]` — section 47: registers a project and boots the
 * local agent against it. In this scaffold it simply spawns the local-agent
 * package with DEVBRIDGE_PROJECT_ROOT set; a packaged CLI would instead
 * spawn a bundled binary.
 */
export function startCommand(dir: string = process.cwd()) {
  const root = resolve(dir);
  console.log(`[devbridge] starting local agent for ${root}`);
  const child = spawn("pnpm", ["--filter", "@devbridge/local-agent", "dev"], {
    stdio: "inherit",
    env: { ...process.env, DEVBRIDGE_PROJECT_ROOT: root },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
