import { describe, expect, it } from "vitest";
import { MAX_WS_FRAME_BYTES, findPayloadViolations } from "@devbridge/protocol";
import { handleRuntimeFrame, runtimeErrorEnvelope } from "./runtime";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §A1/A2 and
 * Batch 3 §3: every WebSocket frame entering the agent is validated before
 * ingest or broadcast. The old handler parsed, cast, and re-broadcast
 * `msg.type as any` — unknown types, missing fields, and unbounded payloads
 * all flowed straight into the StateStore and out to every panel.
 */

const VALID_STATE_CHANGED = JSON.stringify({
  type: "state.changed",
  devId: "dvi_abc123",
  payload: { props: { amount: 49.99 }, state: { loading: false }, context: {} },
  timestamp: new Date().toISOString(),
});

describe("handleRuntimeFrame — valid frames", () => {
  it("accepts a well-formed state.changed frame with a store-ready snapshot", () => {
    const res = handleRuntimeFrame(VALID_STATE_CHANGED);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frame.type).toBe("state.changed");
    expect(res.snapshot).toMatchObject({
      devId: "dvi_abc123",
      props: { amount: 49.99 },
      state: { loading: false },
    });
  });

  it("accepts component.render frames without a snapshot (broadcast only)", () => {
    const res = handleRuntimeFrame(
      JSON.stringify({
        type: "component.render",
        devId: "dvi_abc123",
        payload: { durationMs: 12.5, reason: "mount" },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frame.type).toBe("component.render");
    expect(res.snapshot).toBeNull();
  });

  it("fills in a timestamp when the client omits it", () => {
    const res = handleRuntimeFrame(
      JSON.stringify({
        type: "state.changed",
        devId: "dvi_x",
        payload: { props: {}, state: {}, context: {} },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(typeof res.snapshot?.timestamp).toBe("string");
  });

  it("coerces non-object props/state/context to empty records", () => {
    const res = handleRuntimeFrame(
      JSON.stringify({
        type: "state.changed",
        devId: "dvi_x",
        payload: { props: [1, 2], state: "oops", context: null },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot?.props).toEqual({});
    expect(res.snapshot?.state).toEqual({});
    expect(res.snapshot?.context).toEqual({});
  });
});

describe("handleRuntimeFrame — invalid frames (rejected, never thrown)", () => {
  it("rejects unknown message types instead of broadcasting them", () => {
    const res = handleRuntimeFrame(
      JSON.stringify({ type: "state.deleted", devId: "dvi_x", payload: {} }),
    );
    expect(res).toMatchObject({ ok: false, code: "invalid-frame" });
  });

  it("rejects missing devId and missing payload", () => {
    expect(handleRuntimeFrame(JSON.stringify({ type: "state.changed", payload: {} }))).toMatchObject({
      ok: false,
      code: "invalid-frame",
    });
    expect(
      handleRuntimeFrame(JSON.stringify({ type: "state.changed", devId: "dvi_x" })),
    ).toMatchObject({ ok: false, code: "invalid-frame" });
  });

  it("rejects wrong field types (numeric devId, string duration)", () => {
    expect(
      handleRuntimeFrame(
        JSON.stringify({ type: "state.changed", devId: 42, payload: { props: {}, state: {}, context: {} } }),
      ),
    ).toMatchObject({ ok: false, code: "invalid-frame" });
    expect(
      handleRuntimeFrame(
        JSON.stringify({
          type: "component.render",
          devId: "dvi_x",
          payload: { durationMs: "fast", reason: "mount" },
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid-frame" });
  });

  it("rejects malformed JSON without throwing", () => {
    expect(handleRuntimeFrame("{not json")).toMatchObject({ ok: false, code: "invalid-json" });
    expect(handleRuntimeFrame("")).toMatchObject({ ok: false, code: "invalid-json" });
  });

  it("rejects oversized raw frames before parsing", () => {
    const big = "x".repeat(MAX_WS_FRAME_BYTES + 1);
    expect(handleRuntimeFrame(JSON.stringify({ type: "x", devId: big }))).toMatchObject({
      ok: false,
      code: "frame-too-large",
    });
  });

  it("rejects overweight payloads (deep nesting, huge strings, key floods)", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { nest: deep };
    expect(
      handleRuntimeFrame(
        JSON.stringify({ type: "state.changed", devId: "dvi_x", payload: { props: deep, state: {}, context: {} } }),
      ),
    ).toMatchObject({ ok: false, code: "payload-too-large" });

    const flood: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) flood[`k${i}`] = i;
    expect(
      handleRuntimeFrame(
        JSON.stringify({ type: "state.changed", devId: "dvi_x", payload: { props: flood, state: {}, context: {} } }),
      ),
    ).toMatchObject({ ok: false, code: "payload-too-large" });
  });

  it("rejection details never echo payload content", () => {
    const secret = "SECRET-" + "s".repeat(70000);
    const res = handleRuntimeFrame(
      JSON.stringify({ type: "state.changed", devId: "dvi_x", payload: { props: { pw: secret }, state: {}, context: {} } }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).not.toContain("SECRET");
  });

  it("repeated malformed frames are independent — validator holds no error state", () => {
    for (let i = 0; i < 50; i++) {
      expect(handleRuntimeFrame(`broken-${i} {{{`).ok).toBe(false);
    }
    expect(handleRuntimeFrame(VALID_STATE_CHANGED).ok).toBe(true);
  });
});

describe("findPayloadViolations", () => {
  it("accepts ordinary snapshots and flags pathological ones", () => {
    expect(findPayloadViolations({ a: [1, 2, { b: "x" }] })).toEqual([]);
    expect(findPayloadViolations({ s: "y".repeat(70000) })).toHaveLength(1);
  });
});

describe("runtimeErrorEnvelope", () => {
  it("produces a parseable error frame without payload content", () => {
    const parsed = JSON.parse(runtimeErrorEnvelope("invalid-json", "frame is not valid JSON"));
    expect(parsed).toEqual({ type: "devbridge:error", code: "invalid-json", message: "frame is not valid JSON" });
  });
});
