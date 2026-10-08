/**
 * Runtime validation for anything crossing a trust boundary (browser -> agent,
 * CLI -> agent). Per section 51: "the local agent doesn't blindly trust
 * arbitrary JSON."
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Inbound size policy. Length caps live here (not in each caller) so every
// entry point enforces the same limits (audit A2/A3).
// ---------------------------------------------------------------------------

/** Raw WebSocket text frame cap. Snapshots are small; anything larger is hostile or broken. */
export const MAX_WS_FRAME_BYTES = 256 * 1024;
/** Longest accepted devId on any inbound frame. */
export const MAX_DEVID_LENGTH = 128;
/** Largest accepted `/identity/bulk` batch (the Vite plugin sends per-file handfuls). */
export const MAX_BULK_IDENTITIES = 2000;
/** Filesystem path cap for identity source files (also enforced by containment). */
export const MAX_PATH_LENGTH = 512;
/** Component-name cap for inbound identities. */
export const MAX_COMPONENT_LENGTH = 256;
/** Deepest accepted nesting inside a runtime payload object. */
export const MAX_PAYLOAD_DEPTH = 10;
/** Most object keys / array items accepted anywhere inside one payload. */
export const MAX_PAYLOAD_NODES = 1000;
/** Longest single string accepted inside a runtime payload. */
export const MAX_PAYLOAD_STRING = 64 * 1024;

export const SourceLocationSchema = z.object({
  file: z.string().min(1).max(MAX_PATH_LENGTH),
  start: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }),
  end: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }),
});

export const DevIdentitySchema = z.object({
  id: z.string().regex(/^dvi_[a-f0-9]+$/).max(MAX_DEVID_LENGTH),
  framework: z.enum(["react", "vue", "svelte", "angular", "unknown"]),
  component: z.string().max(MAX_COMPONENT_LENGTH).nullable(),
  source: SourceLocationSchema,
  parentId: z.string().max(MAX_DEVID_LENGTH).nullable(),
  runtimeInstance: z.string().max(MAX_DEVID_LENGTH).optional(),
});

export const PatchRequestSchema = z.object({
  file: z.string().min(1),
  originalHash: z.string().min(1),
  diff: z.string().min(1),
  origin: z.enum(["manual", "ai", "token-sync"]),
  devId: z.string().optional(),
});
export type PatchRequest = z.infer<typeof PatchRequestSchema>;

export const ApplyPatchRequestSchema = z.object({
  patchId: z.string().min(1),
});

export const AIPermissionsSchema = z.object({
  styling: z.boolean(),
  accessibility: z.boolean(),
  tests: z.boolean(),
  logic: z.boolean(),
  backend: z.boolean(),
  dependencies: z.boolean(),
});

export const DevBridgeEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  payload: z.unknown(),
});

// ---------------------------------------------------------------------------
// Runtime frames (browser app -> local agent over the /runtime WebSocket).
// Section 51: the agent never trusts these — every frame is validated before
// it is ingested or re-broadcast (audit A1/A2).
// ---------------------------------------------------------------------------

const DevIdSchema = z.string().min(1).max(MAX_DEVID_LENGTH);

export const RuntimeStateChangedSchema = z.object({
  type: z.literal("state.changed"),
  devId: DevIdSchema,
  payload: z.object({
    props: z.unknown(),
    state: z.unknown(),
    context: z.unknown(),
  }),
  timestamp: z.string().max(64).optional(),
});

export const RuntimeComponentRenderSchema = z.object({
  type: z.literal("component.render"),
  devId: DevIdSchema,
  payload: z.object({
    durationMs: z.number().finite().nonnegative(),
    reason: z.string().max(256),
  }),
  timestamp: z.string().max(64).optional(),
});

/**
 * Every frame the /runtime socket accepts. Unknown `type` values fail the
 * discriminated union — they are rejected, never broadcast (audit A1).
 */
export const RuntimeFrameSchema = z.discriminatedUnion("type", [
  RuntimeStateChangedSchema,
  RuntimeComponentRenderSchema,
]);
export type RuntimeFrame = z.infer<typeof RuntimeFrameSchema>;

/**
 * Structural size walk over an already-parsed payload. Zod checks the shape;
 * this checks the weight: total node count, nesting depth, and individual
 * string lengths. Returns human-readable violations (empty = within limits).
 * Never throws and never includes payload content — safe to log the results.
 */
export function findPayloadViolations(value: unknown): string[] {
  const violations: string[] = [];
  let nodes = 0;
  const visit = (node: unknown, depth: number): void => {
    if (violations.length > 8) return; // cap the report, not the walk
    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES) {
      violations.push(`payload exceeds ${MAX_PAYLOAD_NODES} values`);
      return;
    }
    if (typeof node === "string") {
      if (node.length > MAX_PAYLOAD_STRING) {
        violations.push(`payload string of ${node.length} chars exceeds ${MAX_PAYLOAD_STRING}`);
      }
      return;
    }
    if (depth > MAX_PAYLOAD_DEPTH) {
      violations.push(`payload exceeds ${MAX_PAYLOAD_DEPTH} levels of nesting`);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const value of Object.values(node)) visit(value, depth + 1);
    }
  };
  visit(value, 0);
  return violations;
}
