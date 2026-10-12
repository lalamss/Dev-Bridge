import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

/**
 * Robust VS Code discovery + launch for the local agent.
 *
 * Why this exists: the old opener ran bare `spawn("code", …, { shell: false })`
 * and reported anything it could not start as "not found on PATH". On Windows
 * that misdiagnoses the common cases —
 *   - `code` resolves to a `code.cmd` batch shim, which Node cannot spawn
 *     without a shell, so ENOENT fires even with VS Code installed and on
 *     PATH;
 *   - the agent inherits its environment at launch, so a PATH change made in
 *     a new terminal (or the VS Code installer) is invisible to an
 *     already-running agent;
 *   - a user-level install is often absent from PATH entirely.
 * This module instead resolves a concrete launcher in a fixed order, launches
 * it with an argv array (never a shell string), caches the positive result,
 * and tells the three failure modes apart.
 *
 * Process-lifecycle contract (the "starts, then exits" fix): a resolved
 * launcher is either a short-lived CLI shim (`code.cmd`, POSIX `code`), which
 * delegates to the desktop app and exits promptly, or the desktop executable
 * itself (`Code.exe`), which lives as long as its window. CLI launchers are
 * awaited for a handshake exit code; the desktop app is spawned detached
 * with ignored stdio, verified alive past a short grace window, then released
 * — its lifetime is never awaited and no kill timeout is ever applied to it.
 * Awaiting `close` on the desktop app (plus Node's `timeout` kill) is what
 * used to terminate a successfully started VS Code after ~15 seconds.
 */

export class EditorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorUnavailableError";
  }
}

/** VS Code is not installed (or nothing usable was found). Answered as 503. */
export class VSCodeNotInstalledError extends EditorUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "VSCodeNotInstalledError";
  }
}

/** A resolved launcher plus how it was found (for diagnostics, not UI). */
export interface VSCodeInstall {
  executable: string;
  via: "config" | "PATH" | "install-location" | "windows-resolution";
}

const VERSION_PROBE_TIMEOUT_MS = 8000;
/** Handshake window for short-lived CLI launchers (they exit in ~1s). */
const CLI_HANDSHAKE_TIMEOUT_MS = 15000;
/** Liveness window for the desktop app: still alive (or cleanly handed off)
 *  after this long counts as launched. */
const DESKTOP_GRACE_MS = 1500;
/** Explicit override: an exact file consulted before anything else. */
const OVERRIDE_ENV_VAR = "DEVBRIDGE_VSCODE_PATH";
/** Negative results are cached briefly so rapid retries stay cheap while a
 *  fresh install (or override) is still picked up quickly. */
const NEGATIVE_CACHE_TTL_MS = 30_000;

export interface DiscoveryDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  exists?: (p: string) => boolean;
  /** True when `exe --version` exits 0. Defaults to a real probe. */
  probe?: (exe: string) => Promise<boolean>;
  /** Windows shell/registry resolution. Defaults to `where` + App Paths. */
  systemResolve?: (names: string[], deps: ResolvedDeps) => Promise<string[]>;
  now?: () => number;
}

interface ResolvedDeps {
  platform: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
  probe: (exe: string) => Promise<boolean>;
  systemResolve: (names: string[], deps: ResolvedDeps) => Promise<string[]>;
  now: () => number;
}

function resolveDeps(deps: DiscoveryDeps): ResolvedDeps {
  return {
    platform: deps.platform ?? process.platform,
    env: deps.env ?? process.env,
    exists: deps.exists ?? existsSync,
    probe: deps.probe ?? defaultVersionProbe,
    systemResolve: deps.systemResolve ?? defaultSystemResolve,
    now: deps.now ?? Date.now,
  };
}

function isWindowsScript(exe: string): boolean {
  return /\.(cmd|bat|com)$/i.test(exe);
}

/**
 * Quote one argv element for cmd.exe. Node concatenates file+args with plain
 * spaces when spawning through a shell (DEP0190: no escaping), so the
 * default user-level install dir (`...\Microsoft VS Code\bin\code.cmd`)
 * would otherwise split into several commands and fail with
 * `"...Microsoft" is not recognized...`. `"` is illegal in Windows file
 * names, so wrapping is sufficient; values without whitespace pass through
 * untouched to keep diagnostics readable.
 */
export function quoteCmdArg(value: string): string {
  if (value.length === 0 || /[\s"]/.test(value)) return `"${value.replace(/"/g, "")}"`;
  return value;
}

/** Applies cmd.exe quoting to a file+argv pair before a shelled spawn. */
function shellQuote(exe: string, args: string[]): { file: string; argv: string[] } {
  return { file: quoteCmdArg(exe), argv: args.map(quoteCmdArg) };
}

function tryExec(
  exe: string,
  args: string[],
  opts: { shell: boolean; timeout: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    // Shelled spawns go through cmd.exe, which needs quoted argv (see
    // quoteCmdArg). Shell-free spawns pass argv directly — never quote those.
    const cmd = opts.shell ? shellQuote(exe, args) : { file: exe, argv: args };
    let child: ChildProcess;
    try {
      child = execFile(
        cmd.file,
        cmd.argv,
        { shell: opts.shell, timeout: opts.timeout, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              ok: false,
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
              error: error as NodeJS.ErrnoException,
            });
            return;
          }
          resolve({ ok: true, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        },
      );
    } catch (err) {
      resolve({ ok: false, stdout: "", stderr: "", error: err as NodeJS.ErrnoException });
      return;
    }
    child.on("error", (err) => {
      resolve({ ok: false, stdout: "", stderr: "", error: err as NodeJS.ErrnoException });
    });
  });
}

export async function defaultVersionProbe(
  exe: string,
  exec: typeof tryExec = tryExec,
): Promise<boolean> {
  const direct = await exec(exe, ["--version"], { shell: false, timeout: VERSION_PROBE_TIMEOUT_MS });
  if (direct.ok) return true;
  // A .cmd/.bat shim cannot run without a shell even when it is valid.
  // Older Node reports async ENOENT; newer Node throws EINVAL synchronously
  // (both surface here as !ok) — either way, retry through the shell, where
  // tryExec quotes the space-containing install dir (see quoteCmdArg).
  if (process.platform === "win32" && isWindowsScript(exe)) {
    const shelled = await exec(exe, ["--version"], { shell: true, timeout: VERSION_PROBE_TIMEOUT_MS });
    return shelled.ok;
  }
  return false;
}

/** Candidate launcher file names, stable before Insiders. */
function launcherNames(platform: string): string[] {
  if (platform === "win32") {
    return ["code.cmd", "code.exe", "code", "code-insiders.cmd", "code-insiders.exe", "code-insiders"];
  }
  return ["code", "code-insiders"];
}

function pathDirs(env: Record<string, string | undefined>, platform: string): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of raw.split(delimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  void platform;
  return out;
}

function installLocationCandidates(env: Record<string, string | undefined>, platform: string): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? "";
    const pf = env.ProgramFiles ?? "";
    const pf86 = env["ProgramFiles(x86)"] ?? "";
    const roots = [
      local ? join(local, "Programs", "Microsoft VS Code") : "",
      pf ? join(pf, "Microsoft VS Code") : "",
      pf86 ? join(pf86, "Microsoft VS Code") : "",
      local ? join(local, "Programs", "Microsoft VS Code Insiders") : "",
      pf ? join(pf, "Microsoft VS Code Insiders") : "",
      pf86 ? join(pf86, "Microsoft VS Code Insiders") : "",
    ].filter(Boolean);
    const out: string[] = [];
    for (const root of roots) {
      const insiders = root.includes("Insiders");
      out.push(join(root, "bin", insiders ? "code-insiders.cmd" : "code.cmd"));
      out.push(join(root, insiders ? "Code - Insiders.exe" : "Code.exe"));
    }
    return out;
  }
  const macStable = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  const macInsiders = "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders";
  return [
    "/usr/local/bin/code",
    "/usr/bin/code",
    "/opt/visual-studio-code/bin/code",
    macStable,
    "/usr/local/bin/code-insiders",
    macInsiders,
  ];
}

/**
 * Windows shell + registry resolution for names PATH scanning can miss.
 * Fixed argv only — `names` are file names from our own constant lists, never
 * user input. Failures resolve to [] so discovery simply moves on.
 */
async function defaultSystemResolve(names: string[], deps: ResolvedDeps): Promise<string[]> {
  if (deps.platform !== "win32") return [];
  const found: string[] = [];
  try {
    const where = await tryExec("where", names, { shell: false, timeout: VERSION_PROBE_TIMEOUT_MS });
    if (where.ok) {
      for (const line of where.stdout.split(/\r?\n/)) {
        const trimmed = line.trim().replace(/^"|"$/g, "");
        if (trimmed) found.push(trimmed);
      }
    }
  } catch {
    /* fall through to registry */
  }
  for (const app of ["Code.exe", "Code - Insiders.exe"]) {
    for (const hive of ["HKLM", "HKCU"]) {
      try {
        const queried = await tryExec(
          "reg",
          ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app}`, "/ve"],
          { shell: false, timeout: VERSION_PROBE_TIMEOUT_MS },
        );
        if (!queried.ok) continue;
        const match = queried.stdout.match(/REG_SZ\s+(.+?)\s*$/m);
        const dir = match?.[1]?.trim().replace(/^"|"$/g, "");
        if (dir) found.push(dir);
      } catch {
        /* next hive */
      }
    }
  }
  return [...new Set(found)];
}

async function firstUsable(candidates: string[], deps: ResolvedDeps): Promise<string | null> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    let present = false;
    try {
      present = deps.exists(candidate);
    } catch {
      present = false;
    }
    if (!present) continue;
    try {
      if (await deps.probe(candidate)) return candidate;
    } catch {
      /* unusable — try the next candidate */
    }
  }
  return null;
}

function notInstalledMessage(overrideNote: string): string {
  return (
    "VS Code was not detected on this machine " +
    "(checked PATH, standard install locations, and Windows app registrations)." +
    " Install VS Code from https://code.visualstudio.com, then click “Open in VS Code” again — no PATH setup is required." +
    overrideNote
  );
}

async function discover(deps: ResolvedDeps): Promise<VSCodeInstall> {
  // 1. Explicit override wins when it points at something usable.
  const override = (deps.env[OVERRIDE_ENV_VAR] ?? "").trim().replace(/^"|"$/g, "");
  let overrideNote = ` If VS Code lives somewhere unusual, set ${OVERRIDE_ENV_VAR} to its Code.exe or 'code' launcher and retry.`;
  if (override) {
    let present = false;
    try {
      present = deps.exists(override);
    } catch {
      present = false;
    }
    if (present) {
      try {
        if (await deps.probe(override)) {
          return { executable: override, via: "config" };
        }
      } catch {
        /* fall through to automatic discovery */
      }
      overrideNote = ` ${OVERRIDE_ENV_VAR} is set to "${override}" but that launcher did not respond — continuing with automatic discovery.`;
    } else {
      overrideNote = ` ${OVERRIDE_ENV_VAR} is set to "${override}" but no file exists there — continuing with automatic discovery.`;
    }
  }

  // 2. PATH (handles spaces: entries are joined, never shell-concatenated).
  const names = launcherNames(deps.platform);
  const pathHits: string[] = [];
  for (const dir of pathDirs(deps.env, deps.platform)) {
    for (const name of names) pathHits.push(join(dir, name));
  }
  const onPath = await firstUsable(pathHits, deps);
  if (onPath) return { executable: onPath, via: "PATH" };

  // 3. Well-known install locations (user + system + Insiders).
  const located = await firstUsable(installLocationCandidates(deps.env, deps.platform), deps);
  if (located) return { executable: located, via: "install-location" };

  // 4. Windows shell/registry resolution.
  const resolved = await deps.systemResolve(names, deps);
  const viaSystem = await firstUsable(resolved, deps);
  if (viaSystem) return { executable: viaSystem, via: "windows-resolution" };

  throw new VSCodeNotInstalledError(notInstalledMessage(overrideNote));
}

let cachedInstall: VSCodeInstall | null = null;
let cachedFailureAt = 0;

export async function resolveVSCodeExecutable(depsInput: DiscoveryDeps = {}): Promise<VSCodeInstall> {
  const deps = resolveDeps(depsInput);
  if (cachedInstall) return cachedInstall;
  if (cachedFailureAt > 0 && deps.now() - cachedFailureAt < NEGATIVE_CACHE_TTL_MS) {
    throw new VSCodeNotInstalledError(notInstalledMessage(` If VS Code lives somewhere unusual, set ${OVERRIDE_ENV_VAR} to its Code.exe or 'code' launcher and retry.`));
  }
  try {
    cachedInstall = await discover(deps);
    cachedFailureAt = 0;
    return cachedInstall;
  } catch (err) {
    cachedFailureAt = deps.now();
    throw err;
  }
}

/** Clears cached discovery (success or failure) so the next open re-checks. */
export function refreshVSCodeDiscovery(): void {
  cachedInstall = null;
  cachedFailureAt = 0;
}

export interface SpawnedProcess {
  pid?: number;
  stderr?: { on(event: "data", listener: (chunk: unknown) => void): void } | null;
  on(event: "error" | "close" | "exit", listener: (...args: any[]) => void): void;
  kill?(signal?: string): void;
  unref?(): void;
}

export interface SpawnProcessOptions {
  shell: boolean;
  detached: boolean;
  windowsHide: boolean;
  stdio: "ignore" | "pipe";
}

export type SpawnProcessFn = (exe: string, args: string[], opts: SpawnProcessOptions) => SpawnedProcess;

function defaultSpawnProcess(exe: string, args: string[], opts: SpawnProcessOptions): SpawnedProcess {
  // Shelled spawns (.cmd/.bat shims on Windows) go through cmd.exe, which
  // needs quoted argv (see quoteCmdArg); shell-free spawns pass argv
  // directly. Quoting lives here — at the real-spawn layer — so callers and
  // unit-test harnesses keep seeing the plain argv array.
  const cmd = opts.shell ? shellQuote(exe, args) : { file: exe, argv: args };
  const child = spawn(cmd.file, cmd.argv, {
    shell: opts.shell,
    detached: opts.detached,
    windowsHide: opts.windowsHide,
    stdio: opts.stdio === "ignore" ? "ignore" : ["ignore", "pipe", "pipe"],
  });
  return {
    pid: child.pid,
    stderr: child.stderr,
    on: (event, listener) => {
      child.on(event, listener);
    },
    kill: (signal) => {
      try {
        child.kill(signal as NodeJS.Signals);
      } catch {
        /* already gone */
      }
    },
    unref: () => child.unref(),
  };
}

/** CLI shim (delegates + exits) vs the desktop app itself (outlives us). */
export type LauncherKind = "cli" | "desktop";

export function classifyLauncher(executable: string): LauncherKind {
  const base = basename(executable).toLowerCase();
  if (isWindowsScript(executable)) return "cli";
  if (base === "code" || base === "code-insiders") return "cli";
  return "desktop";
}

/** Safe one-line diagnostics: paths and outcomes only, never env contents. */
function logEditorEvent(message: string): void {
  console.log(`[DevBridge][editor] ${message}`);
}

function stderrSnippet(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed ? `: ${trimmed.slice(0, 200)}` : ".";
}

/** Short-lived CLI launcher: await its handshake exit (0 = delegated ok). */
function launchCli(
  exe: string,
  args: string[],
  shell: boolean,
  spawnProcess: SpawnProcessFn,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = spawnProcess(exe, args, { shell, detached: false, windowsHide: true, stdio: "pipe" });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = "";
    try {
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
    } catch {
      /* stderr unavailable — exit code still decides */
    }
    const timer = setTimeout(() => {
      // A delegating CLI that never exits is hung: killing the short-lived
      // shim cannot harm the desktop app (separate process, if any).
      try {
        child.kill?.("SIGTERM");
      } catch {
        /* already gone */
      }
      reject(
        new Error(
          `VS Code CLI "${exe}" did not exit within ${timeoutMs}ms. ` +
            `If VS Code was moved or uninstalled, reinstall it and retry.`,
        ),
      );
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    child.on("error", (err) => settle(() => reject(err)));
    child.on("close", (code: number | null, signal: string | null) =>
      settle(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `VS Code CLI "${exe}" exited (code ${code ?? "unknown"}` +
              `${signal ? `, signal ${signal}` : ""})${stderrSnippet(stderr)} ` +
              `If VS Code was moved or uninstalled, reinstall it and retry.`,
          ),
        );
      }),
    );
  });
}

/**
 * Desktop executable: spawn detached with ignored stdio (no console flash),
 * verify it survives a short grace window, then release it. Its lifetime is
 * never awaited and no kill timeout is ever applied — doing either is what
 * terminated successfully started instances after ~15 seconds.
 */
function launchDesktop(
  exe: string,
  args: string[],
  spawnProcess: SpawnProcessFn,
  graceMs: number,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = spawnProcess(exe, args, { shell: false, detached: true, windowsHide: true, stdio: "ignore" });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Still alive past grace: the app is running — release our handle.
      try {
        child.unref?.();
      } catch {
        /* already gone */
      }
      resolve(child.pid);
    }, graceMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    // ENOENT (stale cache) propagates with its code so the caller re-resolves.
    child.on("error", (err) => fail(err));
    child.on("exit", (code: number | null, signal: string | null) =>
      // Exited inside grace: 0 means a clean handoff (e.g. an existing
      // instance took the file); anything else is a real startup failure.
      {
        if (settled) return;
        if (code === 0) {
          settled = true;
          clearTimeout(timer);
          try {
            child.unref?.();
          } catch {
            /* already gone */
          }
          resolve(child.pid);
          return;
        }
        fail(
          new Error(
            `VS Code exited during startup (code ${code ?? "unknown"}` +
              `${signal ? `, signal ${signal}` : ""}). ` +
              `If VS Code was moved or uninstalled, reinstall it and retry.`,
          ),
        );
      },
    );
  });
}

/**
 * Opens `absPath:line:column` in the discovered VS Code. `absPath` must
 * already be containment-checked by the caller; argv is always an array, so
 * spaces in paths need no quoting and no shell string is ever built.
 * Discovery success and launch success stay distinct: a resolved install
 * that fails to start throws a launch diagnostic, never "not installed".
 */
export async function openFileInVSCode(
  absPath: string,
  line: number,
  column: number,
  opts: DiscoveryDeps & { spawnProcess?: SpawnProcessFn; graceMs?: number; cliTimeoutMs?: number } = {},
): Promise<VSCodeInstall> {
  const { spawnProcess, graceMs, cliTimeoutMs, ...discoveryDeps } = opts;
  const runSpawn = spawnProcess ?? defaultSpawnProcess;
  const grace = graceMs ?? DESKTOP_GRACE_MS;
  const cliTimeout = cliTimeoutMs ?? CLI_HANDSHAKE_TIMEOUT_MS;
  let install = await resolveVSCodeExecutable(discoveryDeps);
  const launch = async (exe: string) => {
    const kind = classifyLauncher(exe);
    const args = ["--goto", `${absPath}:${line}:${column}`];
    logEditorEvent(`launch kind=${kind} via=${install.via} exe="${exe}"`);
    if (kind === "desktop") {
      await launchDesktop(exe, args, runSpawn, grace);
      return;
    }
    // .cmd/.bat shims cannot run without a shell on Windows; everything else
    // stays shell-free. The argv array is never concatenated into a string.
    const shell = process.platform === "win32" && isWindowsScript(exe);
    await launchCli(exe, args, shell, runSpawn, cliTimeout);
  };
  try {
    await launch(install.executable);
    logEditorEvent(`launch ok exe="${install.executable}"`);
    return install;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      logEditorEvent(`launch failed exe="${install.executable}" reason="${(err as Error)?.message ?? err}"`.slice(0, 300));
      throw err;
    }
    // Stale cache (uninstalled/moved between discovery and launch, or a
    // PATH entry that vanished): re-resolve once and retry once. A fresh
    // failure to resolve propagates as not-installed (503).
    logEditorEvent(`launch ENOENT exe="${install.executable}" — re-resolving`);
    refreshVSCodeDiscovery();
    install = await resolveVSCodeExecutable(discoveryDeps);
    try {
      await launch(install.executable);
    } catch {
      throw new EditorUnavailableError(
        `VS Code launcher "${install.executable}" could not be started. ` +
          `If VS Code was moved or uninstalled, reinstall it and retry.`,
      );
    }
    logEditorEvent(`launch ok exe="${install.executable}"`);
    return install;
  }
}
