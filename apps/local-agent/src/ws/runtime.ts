/**
 * Runtime frame validation (audit A1/A2, Batch 3 §3).
 *
 * Every WebSocket message entering the local agent on /runtime passes
 * through here BEFORE it is ingested into the StateStore or re-broadcast on
 * /events. The old handler `JSON.parse`d, cast `payload` without looking,
 * and broadcast `msg.type as any` — any connected socket could inject
 * arbitrary event types, grow the StateStore without bound, and crash
 * nothing only by luck (a throwing handler would have taken the process).
 *
 * Contract:
 * - Oversized raw frames (> MAX_WS_FRAME_BYTES) are rejected before parsing.
 * - Malformed JSON, unknown `type`, missing/wrong-typed fields are rejected
 *   against RuntimeFrameSchema (protocol, reused — not duplicated here).
 * - Payload weight (depth, node count, string length) is capped by
 *   findPayloadViolations.
 * - Rejection never throws and never includes payload content: the returned
 *   `detail` is safe to send back to the sender and safe to count, but full
 *   payloads are never logged (no secrets in logs).
 * - One bad frame affects only itself — the socket stays open and healthy
 *   clients are untouched. (Hard protocol violations at the `ws` layer, such
 *   as a >maxPayload frame, still close that one socket per RFC 6455 §1009.)
 */

import {
  findPayloadViolations,
  MAX_WS_FRAME_BYTES,
  RuntimeFrameSchema,
  type RuntimeFrame,
  type StateSnapshot,
} from "@devbridge/protocol";

export type RuntimeRejectionCode =
  | "frame-too-large"
  | "invalid-json"
  | "invalid-frame"
  | "payload-too-large";

export interface RuntimeAccepted {
  ok: true;
  /** Validated frame, safe to ingest and broadcast. */
  frame: RuntimeFrame;
  /** StateStore-ready snapshot for `state.changed` frames. */
  snapshot: StateSnapshot | null;
}

export interface RuntimeRejected {
  ok: false;
  code: RuntimeRejectionCode;
  /** Short, content-free reason (safe to send back and to log). */
  detail: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function handleRuntimeFrame(raw: string | Buffer): RuntimeAccepted | RuntimeRejected {
  const text = typeof raw === "string" ? raw : raw.toString("utf-8");

  if (Buffer.byteLength(text, "utf-8") > MAX_WS_FRAME_BYTES) {
    return {
      ok: false,
      code: "frame-too-large",
      detail: `frame exceeds ${MAX_WS_FRAME_BYTES} bytes`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalid-json", detail: "frame is not valid JSON" };
  }

  const frame = RuntimeFrameSchema.safeParse(parsed);
  if (!frame.success) {
    const issues = frame.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, code: "invalid-frame", detail: `frame failed validation: ${issues}` };
  }

  const violations = findPayloadViolations(frame.data.payload);
  if (violations.length > 0) {
    return {
      ok: false,
      code: "payload-too-large",
      detail: `payload exceeds limits: ${violations.slice(0, 3).join("; ")}`,
    };
  }

  let snapshot: StateSnapshot | null = null;
  if (frame.data.type === "state.changed") {
    snapshot = {
      devId: frame.data.devId,
      props: asRecord(frame.data.payload.props),
      state: asRecord(frame.data.payload.state),
      context: asRecord(frame.data.payload.context),
      timestamp: frame.data.timestamp ?? new Date().toISOString(),
    };
  }

  return { ok: true, frame: frame.data, snapshot };
}

/** Content-free error envelope sent back to the offending socket. */
export function runtimeErrorEnvelope(code: RuntimeRejectionCode, detail: string): string {
  return JSON.stringify({ type: "devbridge:error", code, message: detail });
}
