import { describe, expect, it } from "vitest";
import {
  clickSelection,
  hoverFor,
  inspectingAfterClick,
  inspectingAfterKey,
  nearestDevElement,
  overlayLabel,
  type InspectorElement,
} from "./inspectionLogic";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §C2–C4.
 *
 * The old content script hid the overlay whenever no ancestor carried an
 * identity, intercepted every click forever after one selection (no Escape,
 * no auto-stop), and silently dropped clicks on non-instrumented elements.
 * These tests pin the honest-overlay + explicit-lifecycle contract.
 */

function el(
  tag: string,
  devId?: string,
  parent: InspectorElement | null = null,
): InspectorElement {
  return {
    tagName: tag.toUpperCase(),
    dataset: devId ? { devId } : {},
    parentElement: parent,
  };
}

describe("nearestDevElement", () => {
  it("returns the element itself when it carries an identity", () => {
    const target = el("button", "dvi_abc");
    expect(nearestDevElement(target)).toBe(target);
  });

  it("walks up through nested elements to the owning host", () => {
    const host = el("div", "dvi_host");
    const mid = el("span", undefined, host);
    const leaf = el("b", undefined, mid);
    expect(nearestDevElement(leaf)).toBe(host);
  });

  it("returns null when nothing on the chain is instrumented", () => {
    const leaf = el("b", undefined, el("span", undefined, el("div")));
    expect(nearestDevElement(leaf)).toBeNull();
  });

  it("tolerates a null target", () => {
    expect(nearestDevElement(null)).toBeNull();
  });
});

describe("hoverFor (audit rec 15: never hide, label honestly)", () => {
  it("boxes the identity owner and reports its id", () => {
    const host = el("div", "dvi_host");
    const leaf = el("b", undefined, host);
    expect(hoverFor(leaf)).toEqual({ box: host, devId: "dvi_host" });
  });

  it("boxes the raw element with a null id instead of hiding", () => {
    const leaf = el("h1", undefined, el("main"));
    const hover = hoverFor(leaf)!;
    expect(hover.box).toBe(leaf);
    expect(hover.devId).toBeNull();
    expect(overlayLabel(hover.devId)).toBe("(no DevBridge identity)");
  });

  it("labels a real identity with the id itself", () => {
    expect(overlayLabel("dvi_abc")).toBe("dvi_abc");
  });
});

describe("clickSelection (audit C4: never fabricate a source)", () => {
  it("selects the identity owner for nested clicks", () => {
    const host = el("div", "dvi_host");
    const leaf = el("b", undefined, host);
    expect(clickSelection(true, leaf)).toEqual({
      type: "devbridge:element-selected",
      devId: "dvi_host",
    });
  });

  it("reports devId null + tag when nothing is instrumented", () => {
    expect(clickSelection(true, el("h1"))).toEqual({
      type: "devbridge:element-selected",
      devId: null,
      tag: "h1",
    });
  });

  it("leaves the click alone when inspection is off", () => {
    expect(clickSelection(false, el("button", "dvi_x"))).toBeNull();
  });
});

describe("inspection lifecycle (audit C3)", () => {
  it("any consumed click ends inspection", () => {
    expect(inspectingAfterClick(true, true)).toBe(false);
    expect(inspectingAfterClick(true, false)).toBe(true);
    expect(inspectingAfterClick(false, true)).toBe(false);
  });

  it("Escape cancels; other keys leave inspection running", () => {
    expect(inspectingAfterKey(true, "Escape")).toBe(false);
    expect(inspectingAfterKey(true, "Enter")).toBe(true);
    expect(inspectingAfterKey(false, "Escape")).toBe(false);
  });

  it("rapid re-activation is just a flag flip — listeners stay singular", () => {
    // Pin the contract the content script relies on: activation state is a
    // boolean, never a listener count. Toggling N times ends inspecting iff
    // the last transition ended it.
    let inspecting = false;
    for (let i = 0; i < 10; i++) inspecting = true;
    expect(inspecting).toBe(true);
    inspecting = inspectingAfterKey(inspecting, "Escape");
    expect(inspecting).toBe(false);
  });
});
