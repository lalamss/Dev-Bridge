import { describe, expect, it } from "vitest";
import {
  PortDirectory,
  parsePortName,
  type ElementSelectedMessage,
  type PortLike,
} from "./portRouting";

/**
 * Regression coverage for docs/audit/2026-10-05-audit.md §C1.
 *
 * The old single-slot map disconnected whichever document was already
 * connected whenever the other connected — with both sides reconnecting
 * every 500 ms that was a mutual-eviction loop at ~2 Hz, and selections
 * delivered to the DevTools page (which had no onMessage listener) were
 * silently dropped. These tests pin the new contract: roles never evict
 * each other, same-role reconnects supersede cleanly, and selections are
 * never delivered to a document with no listener without being buffered.
 */

function fakePort(name: string): PortLike & { sent: unknown[]; disconnected: boolean } {
  return {
    name,
    sent: [],
    disconnected: false,
    postMessage(message: unknown) {
      this.sent.push(message);
    },
    disconnect() {
      this.disconnected = true;
    },
  };
}

describe("parsePortName", () => {
  it("distinguishes the devtools page from the panel by prefix", () => {
    expect(parsePortName("devbridge-devtools-12")).toEqual({ role: "devtools", tabId: 12 });
    expect(parsePortName("devbridge-panel-12")).toEqual({ role: "panel", tabId: 12 });
  });

  it("rejects the legacy shared name and malformed suffixes", () => {
    // The legacy name `devbridge-panel-{tabId}` is still a panel port — what
    // must never come back is a single shared slot for both documents.
    expect(parsePortName("devbridge-panel-abc")).toBeNull();
    expect(parsePortName("devbridge-panel--1")).toBeNull();
    expect(parsePortName("something-else-3")).toBeNull();
    expect(parsePortName("")).toBeNull();
  });
});

describe("PortDirectory", () => {
  it("holds the devtools page and the panel side by side — no eviction", () => {
    const dir = new PortDirectory();
    const devtools = fakePort("devbridge-devtools-7");
    const panel = fakePort("devbridge-panel-7");

    expect(dir.connect(devtools).previousSameRole).toBeNull();
    // THE C1 REGRESSION: connecting the panel must NOT disconnect the
    // devtools page (and vice versa).
    const second = dir.connect(panel);
    expect(second.previousSameRole).toBeNull();
    expect(devtools.disconnected).toBe(false);
    expect(dir.panelFor(7)).toBe(panel);
    expect(dir.devtoolsFor(7)).toBe(devtools);
  });

  it("a same-role reconnect supersedes only its own predecessor", () => {
    const dir = new PortDirectory();
    const devtools = fakePort("devbridge-devtools-7");
    const panelOld = fakePort("devbridge-panel-7");
    const panelNew = fakePort("devbridge-panel-7");
    dir.connect(devtools);
    dir.connect(panelOld);

    const { previousSameRole } = dir.connect(panelNew);
    expect(previousSameRole).toBe(panelOld);
    expect(dir.panelFor(7)).toBe(panelNew);
    // The other role is untouched.
    expect(dir.devtoolsFor(7)).toBe(devtools);
  });

  it("disconnect only clears the slot when the port still holds it", () => {
    const dir = new PortDirectory();
    const panelOld = fakePort("devbridge-panel-7");
    const panelNew = fakePort("devbridge-panel-7");
    dir.connect(panelOld);
    dir.connect(panelNew);
    // Stale disconnect for the superseded port must not clobber the live one.
    dir.onDisconnect(panelOld);
    expect(dir.panelFor(7)).toBe(panelNew);
    dir.onDisconnect(panelNew);
    expect(dir.panelFor(7)).toBeUndefined();
  });

  it("prefers the panel for selections, falls back to the devtools page", () => {
    const dir = new PortDirectory();
    const devtools = fakePort("devbridge-devtools-7");
    const panel = fakePort("devbridge-panel-7");
    dir.connect(devtools);
    expect(dir.targetForSelection(7)).toBe(devtools);
    dir.connect(panel);
    expect(dir.targetForSelection(7)).toBe(panel);
  });

  it("buffers a selection so a later panel connect still receives it", () => {
    const dir = new PortDirectory();
    const msg: ElementSelectedMessage = {
      type: "devbridge:element-selected",
      devId: "dvi_abc",
      tabId: 7,
    };
    dir.rememberSelection(7, msg);
    expect(dir.takePendingSelection(7)).toEqual(msg);
    // Consumed exactly once.
    expect(dir.takePendingSelection(7)).toBeUndefined();
  });

  it("drops all state for a closed tab", () => {
    const dir = new PortDirectory();
    dir.connect(fakePort("devbridge-devtools-9"));
    dir.connect(fakePort("devbridge-panel-9"));
    dir.rememberSelection(9, { type: "devbridge:element-selected", devId: "dvi_x", tabId: 9 });
    dir.onTabRemoved(9);
    expect(dir.targetForSelection(9)).toBeUndefined();
    expect(dir.takePendingSelection(9)).toBeUndefined();
  });

  it("ignores ports that are not ours", () => {
    const dir = new PortDirectory();
    const stranger = fakePort("some-other-extension-1");
    expect(dir.connect(stranger).parsed).toBeNull();
    expect(dir.targetForSelection(1)).toBeUndefined();
  });
});
