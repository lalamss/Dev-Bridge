import { resolve, sep } from "node:path";
import type { AIPermissions } from "@devbridge/protocol";

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

  constructor(private projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  /** Resolve `relativeOrAbs` and throw unless it is inside the project root. */
  assertPathInProject(relativeOrAbs: string): string {
    const abs = resolve(this.projectRoot, relativeOrAbs);
    const withSep = this.projectRoot.endsWith(sep) ? this.projectRoot : this.projectRoot + sep;
    if (abs !== this.projectRoot && !abs.startsWith(withSep)) {
      throw new PathEscapeError(relativeOrAbs);
    }
    return abs;
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
