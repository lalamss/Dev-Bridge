import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AIPermissions } from "@devbridge/protocol";

/**
 * Resolve symlinks in `absPath`, tolerating a path that does not exist yet —
 * a patch may legitimately create a new file, so the nearest existing ancestor
 * is canonicalized and the remaining segments are appended unchanged. If
 * nothing along the way exists (which cannot happen for a path already
 * constrained to an existing root), the input is returned as-is.
 */
function canonicalize(absPath: string): string {
  const missing: string[] = [];
  let current = absPath;
  for (;;) {
    if (existsSync(current)) {
      let real = realpathSync(current);
      for (const segment of missing) real = join(real, segment);
      return real;
    }
    const parent = dirname(current);
    if (parent === current) return absPath;
    missing.unshift(basename(current));
    current = parent;
  }
}

/**
 * SecurityManager — architecture doc section 52-54:
 *
 *   Web Page (untrusted) -> Chrome Extension (authenticated) ->
 *   Local Agent (permission checked) -> Project Root
 *
 * Never:
 *   Browser -> arbitrary shell
 *   Browser -> arbitrary filesystem
 *
 * Every route that touches the filesystem MUST call `assertPathInProject`
 * before doing anything else. This is intentionally the only place path
 * containment is checked, so there is exactly one thing to audit.
 */
export class PathEscapeError extends Error {
  constructor(public attemptedPath: string) {
    super(`Refused: "${attemptedPath}" resolves outside the authorized project root.`);
    this.name = "PathEscapeError";
  }
}

export class AIPermissionDeniedError extends Error {
  constructor(public category: keyof AIPermissions) {
    super(`AI patch rejected: "${category}" changes are not permitted for this project.`);
    this.name = "AIPermissionDeniedError";
  }
}

const DEFAULT_AI_PERMISSIONS: AIPermissions = {
  styling: true,
  accessibility: true,
  tests: true,
  logic: false,
  backend: false,
  dependencies: false,
};

export class SecurityManager {
  private aiPermissions: AIPermissions = { ...DEFAULT_AI_PERMISSIONS };

  /** Canonical (symlink-resolved) project root, used for containment checks. */
  private readonly canonicalRoot: string;

  constructor(private projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.canonicalRoot = canonicalize(this.projectRoot);
  }

  /**
   * Resolve `relativeOrAbs` and throw unless it is inside the project root.
   *
   * Two checks, both required (docs/audit/2026-10-05-audit.md, S5):
   *
   *   1. Lexical — `resolve()` + containment, which rejects `../../etc/passwd`
   *      and absolute paths outside the root.
   *   2. Canonical — the path with symlinks resolved via `realpath`, compared
   *      against the symlink-resolved root. A purely lexical check is defeated
   *      by any symlink or junction inside the project pointing elsewhere, and
   *      those are routine in pnpm/npm monorepos.
   *
   * The returned path is the canonical one, so callers read and write through
   * the same fully-resolved location that was just validated.
   */
  assertPathInProject(relativeOrAbs: string): string {
    const abs = resolve(this.projectRoot, relativeOrAbs);
    this.assertContained(abs, relativeOrAbs);

    const canonical = canonicalize(abs);
    this.assertContained(canonical, relativeOrAbs);
    return canonical;
  }

  private assertContained(candidate: string, attempted: string): void {
    const rel = relative(this.canonicalRoot, candidate);
    const escapes = rel.startsWith("..") || isAbsolute(rel);
    if (escapes) throw new PathEscapeError(attempted);
  }

  setAIPermissions(permissions: Partial<AIPermissions>): AIPermissions {
    this.aiPermissions = { ...this.aiPermissions, ...permissions };
    return this.aiPermissions;
  }

  getAIPermissions(): AIPermissions {
    return { ...this.aiPermissions };
  }

  /**
   * Section 42: "The patch engine enforces AI permissions. Do not rely on
   * the model to obey its own instructions." Called for every AI-originated
   * patch before it is even created, using a coarse classification of what
   * kind of file/change is being proposed.
   */
  assertAIAllowed(category: keyof AIPermissions): void {
    if (!this.aiPermissions[category]) {
      throw new AIPermissionDeniedError(category);
    }
  }

  /** Never allow the agent to shell out to something the developer didn't configure (test/build commands only). */
  private allowedCommands = new Set<string>();

  registerAllowedCommand(command: string): void {
    this.allowedCommands.add(command);
  }

  assertCommandAllowed(command: string): void {
    if (!this.allowedCommands.has(command)) {
      throw new Error(`Refused: "${command}" is not a registered project command (test/build/dev only).`);
    }
  }
}
