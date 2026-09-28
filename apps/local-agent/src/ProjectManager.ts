import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectInfo } from "@devbridge/protocol";
import { DevIdentityRegistry } from "@devbridge/dev-identity";
import { PatchEngine } from "@devbridge/patch-engine";
import { GitManager } from "@devbridge/git-manager";
import { SecurityManager } from "./SecurityManager";

/**
 * ProjectManager — architecture doc section 53.
 *
 * Holds exactly one active project at a time for this v1 agent (the doc's
 * "devbridge start" picks a root directory). All file operations for the
 * lifetime of the process are restricted to this root via SecurityManager.
 */
export class ProjectManager {
  readonly root: string;
  readonly security: SecurityManager;
  readonly identities = new DevIdentityRegistry();
  readonly patches = new PatchEngine();
  readonly git: GitManager;

  private framework: ProjectInfo["framework"] = "unknown";
  private testCommand?: string;
  private backendCommand?: string;
  private devServerUrl?: string;

  constructor(root: string) {
    this.root = root;
    this.security = new SecurityManager(root);
    this.git = new GitManager(root);
    this.detectFramework();
  }

  private detectFramework(): void {
    const pkgPath = join(this.root, "package.json");
    if (!existsSync(pkgPath)) return;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) this.framework = "react";
      else if (deps.vue) this.framework = "vue";
      else if (deps.svelte) this.framework = "svelte";
      else if (deps["@angular/core"]) this.framework = "angular";

      if (pkg.scripts?.test) {
        this.testCommand = "test";
        this.security.registerAllowedCommand("test");
      }
      if (pkg.scripts?.dev) this.security.registerAllowedCommand("dev");
      if (pkg.scripts?.build) this.security.registerAllowedCommand("build");
    } catch {
      // package.json unreadable / malformed — leave framework as "unknown".
    }
  }

  setDevServerUrl(url: string): void {
    this.devServerUrl = url;
  }

  setBackendCommand(cmd: string): void {
    this.backendCommand = cmd;
    this.security.registerAllowedCommand(cmd);
  }

  async info(): Promise<ProjectInfo> {
    return {
      id: this.root,
      root: this.root,
      framework: this.framework,
      devServerUrl: this.devServerUrl,
      backendCommand: this.backendCommand,
      testCommand: this.testCommand,
      gitClean: await this.git.isClean().catch(() => true),
    };
  }
}
