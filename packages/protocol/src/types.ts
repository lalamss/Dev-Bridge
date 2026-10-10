/**
 * @devbridge/protocol — core shared types.
 *
 * This is the "spine" package (see architecture doc, sections 6, 51, 55).
 * Every other package (dev-identity, patch-engine, local-agent, chrome-extension,
 * cli) imports its domain objects from here so the wire format between the
 * browser, the local agent, and the CLI never drifts.
 */

// ---------------------------------------------------------------------------
// Dev Identity (section 6-7) — the universal correlation key
// ---------------------------------------------------------------------------

export interface SourceLocation {
  file: string; // project-relative path, e.g. "src/components/Hero.tsx"
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface DevIdentity {
  id: string; // "dvi_<hash>"
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";
  component: string | null;
  source: SourceLocation;
  parentId: string | null;
  runtimeInstance?: string;
}

// ---------------------------------------------------------------------------
// Component tree (section 10)
// ---------------------------------------------------------------------------

export interface ComponentInfo {
  devId: string;
  name: string;
  children: string[]; // child devIds
}

// ---------------------------------------------------------------------------
// Patches (section 13, 39, 42) — the only way source is ever written
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high";

export type PatchStatus =
  | "proposed"
  | "previewed"
  | "approved"
  | "applied"
  | "rejected"
  | "conflicted";

export type PatchOrigin = "manual" | "ai" | "token-sync";

export interface SourcePatch {
  id: string;
  file: string;
  originalHash: string; // hash of file content the patch was computed against
  diff: string; // unified diff
  origin: PatchOrigin;
  status: PatchStatus;
  risk: RiskLevel;
  riskReasons: string[];
  devId?: string;
  createdAt: string;
}

export interface AIPermissions {
  styling: boolean;
  accessibility: boolean;
  tests: boolean;
  logic: boolean;
  backend: boolean;
  dependencies: boolean;
}

// ---------------------------------------------------------------------------
// Design tokens (section 15-16)
// ---------------------------------------------------------------------------

export interface DesignToken {
  name: string; // "--color-primary-600"
  value: string; // "#2563eb"
  file: string; // source file the token is defined in
  category: "color" | "spacing" | "radius" | "typography" | "shadow" | "other";
}

// ---------------------------------------------------------------------------
// Accessibility (section 17-19)
// ---------------------------------------------------------------------------

export interface A11yIssue {
  id: string;
  devId: string;
  rule: string; // e.g. "color-contrast"
  severity: "info" | "warning" | "error";
  message: string;
  expected?: string;
  actual?: string;
}

// ---------------------------------------------------------------------------
// Runtime / state (section 21-25)
// ---------------------------------------------------------------------------

export interface StateSnapshot {
  devId: string;
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  context: Record<string, unknown>;
  timestamp: string;
}

export interface RenderEvent {
  devId: string;
  timestamp: string;
  durationMs: number;
  reason: "mount" | "props-changed" | "state-changed" | "context-changed" | "parent";
}

// ---------------------------------------------------------------------------
// Network / backend correlation (section 26-29)
// ---------------------------------------------------------------------------

export interface NetworkRequestEvent {
  id: string;
  method: string;
  url: string;
  status?: number;
  triggeredByDevId?: string;
  traceId?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface BackendTrace {
  traceId: string;
  service: string;
  file?: string;
  line?: number;
  message: string;
  level: "info" | "warn" | "error";
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Git / safety (section 40, 54)
// ---------------------------------------------------------------------------

export interface GitCheckpoint {
  sha: string;
  message: string;
  createdBy: "devbridge" | "user";
  timestamp: string;
  testsPassing: boolean | null;
}

// ---------------------------------------------------------------------------
// Sessions (section 30-32)
// ---------------------------------------------------------------------------

export interface SessionEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface Session {
  id: string;
  startedAt: string;
  endedAt?: string;
  events: SessionEvent[];
  redacted: boolean;
}

// ---------------------------------------------------------------------------
// Project (section 53)
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  id: string;
  root: string;
  framework: "react" | "vue" | "svelte" | "angular" | "unknown";
  devServerUrl?: string;
  backendCommand?: string;
  testCommand?: string;
  gitClean: boolean;
}

// ---------------------------------------------------------------------------
// Bidirectional bridge: project connection (browser <-> source)
// ---------------------------------------------------------------------------
//
// The agent serves exactly one project per process (v1). `projectId` is the
// ProjectInfo.id (the canonical root) — stable per machine and checkout, and
// echoed back on every mutating request so a request meant for Project A can
// never be honored by Project B's agent. Framework-specific instrumentation
// stays in adapters/plugins; this layer only carries identities.

/** What the agent can do for its project, as seen by the extension panel. */
export interface ProjectCapabilities {
  /** Build-plugin identities are flowing (registry is non-empty). */
  instrumentation: boolean;
  /** Local editor integration is available (`code` CLI probe). */
  editor: boolean;
}

/**
 * The connection record the panel builds from GET /project plus its own
 * page probe. Stronger than a bare dev-server origin: origin + projectId +
 * framework must all agree before source operations are offered.
 */
export interface ProjectConnection {
  projectId: string;
  root: string;
  framework: ProjectInfo["framework"];
  devServerOrigin?: string;
  capabilities: ProjectCapabilities;
}

/** Browser -> source: ask the agent to open a project file in the editor. */
export interface OpenSourceRequest {
  projectId: string;
  file: string; // project-relative, e.g. "src/pages/Dashboard.tsx"
  line: number; // 1-based
  column: number; // 0-based
}

export interface OpenSourceResult {
  ok: true;
  file: string;
  line: number;
  column: number;
}

/** Facts the content script reports about its page (port message). */
export interface PageInfo {
  origin: string;
  url: string;
  instrumented: boolean;
  identityCount: number;
}

/** Source -> browser: ask the page to find live DOM nodes for devIds. */
export interface LocateDevIdsCommand {
  requestId: string;
  devIds: string[];
}

/** Per-identity live-instance count reported back by the content script. */
export interface RuntimeMatch {
  devId: string;
  instances: number;
}

export interface LocateRuntimeResult {
  requestId: string;
  file: string;
  matches: RuntimeMatch[];
}

// ---------------------------------------------------------------------------
// WebSocket event envelope (section 50-51)
// ---------------------------------------------------------------------------

export type DevBridgeEventType =
  | "file.changed"
  | "runtime.error"
  | "runtime.log"
  | "network.request"
  | "network.response"
  | "component.render"
  | "state.changed"
  | "test.started"
  | "test.finished"
  | "presence.updated"
  | "session.event"
  | "patch.created"
  | "patch.applied";

export interface DevBridgeEvent<T = unknown> {
  type: DevBridgeEventType;
  timestamp: string;
  payload: T;
}
