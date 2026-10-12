import { describe, expect, it } from "vitest";
import { capabilityState, normalizeLoopbackOrigin, VIEW_ORDER, VIEWS, type CapabilityContext } from "./navigation";

/**
 * Navigation + capability-matrix coverage for the redesigned panel.
 *
 * Pins the acceptance rules:
 *   - exactly four destinations, each with a real view (no decorative items);
 *   - capability cards never report availability without a selection and a
 *     connected project — they carry the honest reason instead;
 *   - highlight (page flash) needs only a selection; source actions need
 *     identity + connection too.
 */

describe("navigation destinations", () => {
  it("exposes exactly Inspect, Components, Files, Settings — each a real view", () => {
    expect(VIEW_ORDER).toEqual(["inspect", "components", "files", "settings"]);
    for (const id of VIEW_ORDER) {
      expect(VIEWS[id].label.length).toBeGreaterThan(0);
      expect(VIEWS[id].hint.length).toBeGreaterThan(0);
    }
  });
});

const base: CapabilityContext = {
  connection: "connected",
  hasSelection: true,
  hasIdentity: true,
  busy: false,
  locating: false,
};

function reasons(ctx: Partial<CapabilityContext> = {}) {
  const caps = capabilityState({ ...base, ...ctx });
  return Object.fromEntries(caps.map((c) => [c.id, c.unavailableReason]));
}

describe("capabilityState", () => {
  it("enables every card when selected, identified, and connected", () => {
    const r = reasons();
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });

  it("disables everything with a selection-required reason when nothing is selected", () => {
    const r = reasons({ hasSelection: false, hasIdentity: false, connection: "no-agent" });
    for (const v of Object.values(r)) {
      expect(v).toMatch(/select an element/i);
    }
  });

  it("keeps highlight available with only a selection (no identity needed)", () => {
    const r = reasons({ hasIdentity: false });
    expect(r["highlight"]).toBeNull();
    expect(r["open-editor"]).toMatch(/identity/i);
    expect(r["edit-apply"]).toMatch(/identity/i);
  });

  it("blocks source actions on a disconnected project without inventing success", () => {
    const r = reasons({ connection: "mismatch" });
    expect(r["locate"]).toMatch(/connected project/i);
    expect(r["open-editor"]).toMatch(/connected project/i);
    expect(r["edit-apply"]).toMatch(/connected project/i);
    // Highlight is a page-local flash — still available.
    expect(r["highlight"]).toBeNull();
  });

  it("reports the searching state instead of allowing a duplicate locate", () => {
    const r = reasons({ locating: true });
    expect(r["locate"]).toMatch(/searching/i);
  });

  it("reports busy instead of allowing a duplicate editor open", () => {
    const r = reasons({ busy: true });
    expect(r["open-editor"]).toMatch(/working/i);
  });
});

describe("normalizeLoopbackOrigin", () => {
  it("treats localhost and 127.0.0.1 as the same dev server", () => {
    expect(normalizeLoopbackOrigin("http://localhost:5173")).toBe("http://127.0.0.1:5173");
    expect(normalizeLoopbackOrigin("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173");
  });

  it("preserves ports and leaves non-loopback origins untouched", () => {
    expect(normalizeLoopbackOrigin("http://localhost:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeLoopbackOrigin("http://192.168.1.10:5173")).toBe("http://192.168.1.10:5173");
    expect(normalizeLoopbackOrigin("https://example.com")).toBe("https://example.com");
  });

  it("passes unparseable input through for the caller to handle", () => {
    expect(normalizeLoopbackOrigin("not-a-url")).toBe("not-a-url");
    expect(normalizeLoopbackOrigin("")).toBe("");
  });
});
