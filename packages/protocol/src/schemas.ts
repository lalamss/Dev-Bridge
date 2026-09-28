/**
 * Runtime validation for anything crossing a trust boundary (browser -> agent,
 * CLI -> agent). Per section 51: "the local agent doesn't blindly trust
 * arbitrary JSON."
 */
import { z } from "zod";

export const SourceLocationSchema = z.object({
  file: z.string().min(1),
  start: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }),
  end: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }),
});

export const DevIdentitySchema = z.object({
  id: z.string().regex(/^dvi_[a-f0-9]+$/),
  framework: z.enum(["react", "vue", "svelte", "angular", "unknown"]),
  component: z.string().nullable(),
  source: SourceLocationSchema,
  parentId: z.string().nullable(),
  runtimeInstance: z.string().optional(),
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
