import { describe, expect, it, beforeEach } from "vitest";
import { join } from "node:path";
import {
  classifyLauncher,
  defaultVersionProbe,
  EditorUnavailableError,
  VSCodeNotInstalledError,
  openFileInVSCode,
  quoteCmdArg,
  refreshVSCodeDiscovery,
  resolveVSCodeExecutable,
  type DiscoveryDeps,
  type SpawnedProcess,
  type SpawnProcessFn,
  type SpawnProcessOptions,
} from "./vscode";

/**
 * VS Code discovery + launch coverage (Windows-focused, fully hermetic).
 *
 * Every filesystem, environment, and subprocess interaction is injected, so
 * these tests assert DevBridge's own resolution order and launch contract —
 * never the machine they run on:
 *   1. `code` on PATH wins;
 *   2. a standard install location works with no PATH entry;
 *   3. CLI shims (`code.cmd`) are awaited for a handshake exit; the desktop
 *      executable (`Code.exe`) is spawned detached, verified alive past a
 *      grace window, then released — never awaited, never kill-timed-out;
 *   4. paths with spaces travel as a single argv element (no shell strings);
 *   5. Insiders (CLI and desktop) is detected;
 *   6. nothing found is a distinct not-installed error with a recovery action;
 *   7. a bad CLI exit is a distinct launch failure naming the executable, and
 *      discovery success stays distinct from launch success;
 *   8. line/column arrive as one `--goto <abs>:<line>:<col>` argument;
 *   9. a stale cache self-heals (ENOENT → re-resolve → retry once);
 *  10. positives cache, negatives expire, and refresh re-checks immediately.
 *  11. shelled .cmd probes quote space-containing install dirs (cmd.exe gets
 *      no escaping from Node), and a direct-spawn EINVAL (newer Node) retries
 *      through the shell exactly like ENOENT (older Node).
 */

const WIN_ENV: Record<string, string | undefined> = {
  PATH: "C:\\tools\\bin",
  LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};

const PATH_CODE_CMD = join("C:\\tools\\bin", "code.cmd");
const USER_CODE_EXE = join(
  "C:\\Users\\tester\\AppData\\Local",
  "Programs",
  "Microsoft VS Code",
  "Code.exe",
);
const SYSTEM_CODE_EXE_SPACED = join("C:\\Program Files", "Microsoft VS Code", "Code.exe");
const INSIDERS_CMD = join(
  "C:\\Users\\tester\\AppData\\Local",
  "Programs",
  "Microsoft VS Code Insiders",
  "bin",
  "code-insiders.cmd",
);
const INSIDERS_EXE = join(
  "C:\\Users\\tester\\AppData\\Local",
  "Programs",
  "Microsoft VS Code Insiders",
  "Code - Insiders.exe",
);

function testDeps(files: Iterable<string>, overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  const present = new Set(files);
  return {
    platform: "win32",
    env: { ...WIN_ENV },
    exists: (p: string) => present.has(p),
    probe: async () => true,
    systemResolve: async () => [],
    now: () => 0,
    ...overrides,
  };
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
}

beforeEach(() => {
  refreshVSCodeDiscovery();
});

describe("resolveVSCodeExecutable", () => {
  it("prefers `code` found on PATH", async () => {
    const install = await resolveVSCodeExecutable(testDeps([PATH_CODE_CMD]));
    expect(install.executable).toBe(PATH_CODE_CMD);
    expect(install.via).toBe("PATH");
  });

  it("uses a standard install location with no PATH entry", async () => {
    const deps = testDeps([USER_CODE_EXE], {
      env: { ...WIN_ENV, PATH: "C:\\nothing\\here" },
    });
    const install = await resolveVSCodeExecutable(deps);
    expect(install.executable).toBe(USER_CODE_EXE);
    expect(install.via).toBe("install-location");
  });

  it("honors an explicit DEVBRIDGE_VSCODE_PATH override first", async () => {
    const custom = "D:\\custom\\tools\\code.exe";
    const deps = testDeps([custom, PATH_CODE_CMD], {
      env: { ...WIN_ENV, DEVBRIDGE_VSCODE_PATH: custom },
    });
    const install = await resolveVSCodeExecutable(deps);
    expect(install.executable).toBe(custom);
    expect(install.via).toBe("config");
  });

  it("detects VS Code Insiders", async () => {
    const install = await resolveVSCodeExecutable(testDeps([INSIDERS_CMD]));
    expect(install.executable).toBe(INSIDERS_CMD);
  });

  it("falls back to Windows shell/registry resolution", async () => {
    const viaWhere = join("C:\\found\\by\\where", "code.cmd");
    const deps = testDeps([viaWhere], {
      env: { ...WIN_ENV, PATH: "" },
      systemResolve: async () => [viaWhere],
    });
    const install = await resolveVSCodeExecutable(deps);
    expect(install.executable).toBe(viaWhere);
    expect(install.via).toBe("windows-resolution");
  });

  it("throws a distinct not-installed error with a recovery action", async () => {
    const deps = testDeps([], { env: { ...WIN_ENV, PATH: "" } });
    await expect(resolveVSCodeExecutable(deps)).rejects.toBeInstanceOf(VSCodeNotInstalledError);
    await expect(resolveVSCodeExecutable(deps)).rejects.toBeInstanceOf(EditorUnavailableError);
    refreshVSCodeDiscovery();
    await expect(resolveVSCodeExecutable({ ...deps, now: () => 31_000 }))
      .rejects.toThrow(/code\.visualstudio\.com/);
  });

  it("caches positives and refreshes on demand", async () => {
    expect((await resolveVSCodeExecutable(testDeps([PATH_CODE_CMD]))).executable).toBe(PATH_CODE_CMD);
    // The PATH entry is gone and an install location appeared, but the
    // cached hit still wins until an explicit refresh re-checks.
    const changed = testDeps([USER_CODE_EXE], { env: { ...WIN_ENV, PATH: "C:\\nothing\\here" } });
    expect((await resolveVSCodeExecutable(changed)).executable).toBe(PATH_CODE_CMD);
    refreshVSCodeDiscovery();
    expect((await resolveVSCodeExecutable(changed)).executable).toBe(USER_CODE_EXE);
  });
});

describe("quoteCmdArg", () => {
  it("quotes space-containing install dirs, leaves plain argv untouched", () => {
    expect(quoteCmdArg("C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd")).toBe(
      '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd"',
    );
    expect(quoteCmdArg("C:\\proj\\my app\\a.tsx:12:4")).toBe('"C:\\proj\\my app\\a.tsx:12:4"');
    expect(quoteCmdArg("--version")).toBe("--version");
    expect(quoteCmdArg("--goto")).toBe("--goto");
    expect(quoteCmdArg("C:\\tools\\bin\\code.cmd")).toBe("C:\\tools\\bin\\code.cmd");
  });
});

describe("defaultVersionProbe shell fallback", () => {
  type ExecResult = { ok: boolean; stdout: string; stderr: string; error?: NodeJS.ErrnoException };
  interface SeenExec {
    exe: string;
    args: string[];
    shell: boolean;
  }
  function execHarness(steps: ExecResult[]) {
    const seen: SeenExec[] = [];
    const exec = async (exe: string, args: string[], opts: { shell: boolean; timeout: number }): Promise<ExecResult> => {
      seen.push({ exe, args, shell: opts.shell });
      return steps[Math.min(seen.length - 1, steps.length - 1)];
    };
    return { seen, exec };
  }
  const failWith = (code: string): ExecResult => ({
    ok: false,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error(`spawn ${code}`), { code }),
  });

  it("retries a .cmd shim through the shell when direct spawn reports EINVAL", async () => {
    const { seen, exec } = execHarness([failWith("EINVAL"), { ok: true, stdout: "1.141.0", stderr: "" }]);
    await expect(defaultVersionProbe("C:\\tools\\bin\\code.cmd", exec)).resolves.toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ exe: "C:\\tools\\bin\\code.cmd", shell: false });
    expect(seen[1]).toMatchObject({ exe: "C:\\tools\\bin\\code.cmd", shell: true });
  });

  it("retries a .cmd shim through the shell on ENOENT exactly like EINVAL", async () => {
    const { seen, exec } = execHarness([failWith("ENOENT"), { ok: true, stdout: "1.141.0", stderr: "" }]);
    await expect(defaultVersionProbe("C:\\tools\\bin\\code.cmd", exec)).resolves.toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].shell).toBe(true);
  });

  it("reports unusable when the shelled retry also fails", async () => {
    const { seen, exec } = execHarness([failWith("EINVAL"), failWith("UNKNOWN")]);
    await expect(defaultVersionProbe("C:\\tools\\bin\\code.cmd", exec)).resolves.toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("never shells a native executable, even on spawn failure", async () => {
    const { seen, exec } = execHarness([failWith("EINVAL")]);
    await expect(defaultVersionProbe(USER_CODE_EXE, exec)).resolves.toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].shell).toBe(false);
  });
});

describe("classifyLauncher", () => {
  it("treats shims as short-lived CLI and native exes as the desktop app", () => {
    expect(classifyLauncher("C:\\tools\\bin\\code.cmd")).toBe("cli");
    expect(classifyLauncher("C:\\tools\\bin\\code-insiders.cmd")).toBe("cli");
    expect(classifyLauncher("/usr/local/bin/code")).toBe("cli");
    expect(classifyLauncher("/usr/local/bin/code-insiders")).toBe("cli");
    expect(classifyLauncher(USER_CODE_EXE)).toBe("desktop");
    expect(classifyLauncher(SYSTEM_CODE_EXE_SPACED)).toBe("desktop");
    expect(classifyLauncher(INSIDERS_EXE)).toBe("desktop");
    expect(classifyLauncher(join("C:\\tools\\bin", "code.exe"))).toBe("desktop");
  });
});

/** Controllable child process: no real VS Code is ever spawned in tests. */
class FakeChild implements SpawnedProcess {
  handlers = new Map<string, Array<(...args: any[]) => void>>();
  killed: string[] = [];
  unrefed = 0;
  private stderrListeners: Array<(chunk: unknown) => void> = [];
  stderr = {
    on: (event: "data", listener: (chunk: unknown) => void) => {
      if (event === "data") this.stderrListeners.push(listener);
    },
  };

  on(event: "error" | "close" | "exit", listener: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...args);
  }

  emitStderr(chunk: string): void {
    for (const listener of this.stderrListeners) listener(chunk);
  }

  kill(signal?: string): void {
    this.killed.push(signal ?? "");
  }

  unref(): void {
    this.unrefed += 1;
  }
}

interface SeenSpawn {
  exe: string;
  args: string[];
  opts: SpawnProcessOptions;
  child: FakeChild;
}

function spawningHarness() {
  const seen: SeenSpawn[] = [];
  const spawnProcess: SpawnProcessFn = (exe, args, opts) => {
    const child = new FakeChild();
    seen.push({ exe, args, opts, child });
    return child;
  };
  return { seen, spawnProcess };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("openFileInVSCode", () => {
  it("releases a desktop exe outside PATH after a grace window (no lifetime wait, no kill)", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\my app\\a.tsx", 12, 4, {
      ...testDeps([SYSTEM_CODE_EXE_SPACED]),
      spawnProcess,
      graceMs: 15,
    });
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0].exe).toBe(SYSTEM_CODE_EXE_SPACED);
    expect(seen[0].args).toEqual(["--goto", "C:\\proj\\my app\\a.tsx:12:4"]);
    expect(seen[0].opts).toMatchObject({ shell: false, detached: true, stdio: "ignore" });
    // Still running past grace: success, handle released, process untouched.
    const install = await promise;
    expect(install.executable).toBe(SYSTEM_CODE_EXE_SPACED);
    expect(seen[0].child.unrefed).toBeGreaterThan(0);
    expect(seen[0].child.killed).toEqual([]);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].child.killed).toEqual([]);
  });

  it("treats a clean desktop exit in grace as a handed-off success", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\a.tsx", 3, 2, {
      ...testDeps([USER_CODE_EXE]),
      spawnProcess,
      graceMs: 50,
    });
    await tick();
    // Existing instance took the file: the new process exits 0 at once.
    seen[0].child.emit("exit", 0, null);
    await expect(promise).resolves.toMatchObject({ executable: USER_CODE_EXE });
  });

  it("awaits a CLI shim handshake exit with shell and piped stdio", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\a.tsx", 1, 0, {
      ...testDeps([PATH_CODE_CMD]),
      spawnProcess,
      graceMs: 15,
    });
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0].args).toEqual(["--goto", "C:\\proj\\a.tsx:1:0"]);
    expect(seen[0].opts).toMatchObject({ shell: true, detached: false, stdio: "pipe" });
    seen[0].child.emit("close", 0, null);
    await expect(promise).resolves.toMatchObject({ executable: PATH_CODE_CMD });
  });

  it("reports a bad CLI exit as a launch failure, not as not-installed", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\a.tsx", 3, 2, {
      ...testDeps([PATH_CODE_CMD]),
      spawnProcess,
      graceMs: 15,
    });
    await tick();
    seen[0].child.emitStderr("boom");
    seen[0].child.emit("close", 1, null);
    await expect(promise).rejects.toThrow(/code\.cmd.*exited.*boom/);
    await expect(promise).rejects.not.toBeInstanceOf(VSCodeNotInstalledError);
  });

  it("reports a desktop startup failure distinctly from discovery success", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\a.tsx", 3, 2, {
      ...testDeps([USER_CODE_EXE]),
      spawnProcess,
      graceMs: 50,
    });
    await tick();
    seen[0].child.emit("exit", 1, null);
    await expect(promise).rejects.toThrow(/exited during startup/);
    await expect(promise).rejects.not.toBeInstanceOf(VSCodeNotInstalledError);
  });

  it("opens Insiders desktop builds with detached release semantics", async () => {
    const { seen, spawnProcess } = spawningHarness();
    const promise = openFileInVSCode("C:\\proj\\a.tsx", 7, 8, {
      ...testDeps([INSIDERS_EXE]),
      spawnProcess,
      graceMs: 15,
    });
    await tick();
    expect(seen[0].exe).toBe(INSIDERS_EXE);
    expect(seen[0].opts).toMatchObject({ shell: false, detached: true, stdio: "ignore" });
    const install = await promise;
    expect(install.executable).toBe(INSIDERS_EXE);
  });

  it("re-resolves and retries once after ENOENT, then uses the fresh launcher", async () => {
    const replacement = join("C:\\fresh", "Code.exe");
    const calls: string[] = [];
    // The stale PATH entry vanishes once the failed launch proves it stale.
    let refreshed = false;
    const stale: DiscoveryDeps = {
      platform: "win32",
      env: { ...WIN_ENV },
      exists: (p: string) => (refreshed ? p === replacement : p === PATH_CODE_CMD),
      probe: async () => true,
      systemResolve: async () => (refreshed ? [replacement] : []),
      now: () => 0,
    };
    const { seen, spawnProcess } = spawningHarness();
    const wrappedSpawn: SpawnProcessFn = (exe, args, opts) => {
      calls.push(exe);
      const child = spawnProcess(exe, args, opts) as FakeChild;
      if (exe === PATH_CODE_CMD) {
        setTimeout(() => {
          refreshed = true;
          child.emit("error", enoent());
        }, 0);
      } else {
        setTimeout(() => child.emit("exit", 0, null), 0);
      }
      return child;
    };
    const install = await openFileInVSCode("C:\\proj\\a.tsx", 5, 6, {
      ...stale,
      spawnProcess: wrappedSpawn,
      graceMs: 15,
    });
    expect(calls).toEqual([PATH_CODE_CMD, replacement]);
    expect(install.executable).toBe(replacement);
    expect(install.via).toBe("windows-resolution");
    expect(seen).toHaveLength(2);
  });
});
