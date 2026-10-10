/**
 * Background service worker — the message relay between the content script
 * (page context) and the DevTools panel (architecture doc section 8:
 * "Background/Service Worker").
 *
 * ── Why ports and not sendMessage ──────────────────────────────────────────
 * `chrome.runtime.sendMessage()` is NOT delivered to DevTools pages or
 * DevTools panels. Those documents are invisible to the extension's own
 * broadcast bus, so a `sendMessage()` fired here silently evaporates and the
 * panel never learns which element the user clicked.
 *
 * The supported transport is a long-lived named Port:
 *
 *   Panel  ──postMessage──▶  background  ──tabs.sendMessage──▶  content script
 *   Panel  ◀──postMessage──  background  ◀──onMessage────────  content script
 *
 * ── Why two port names (audit C1) ──────────────────────────────────────────
 * The DevTools page (`devtools.ts`) and the panel (`panel/App.tsx`) used to
 * connect under the SAME name into a single slot, and this worker
 * disconnected whichever port was already there. Both documents reconnect
 * 500 ms after a disconnect — a mutual-eviction loop at ~2 Hz for as long as
 * DevTools stayed open, dropping roughly half of all element selections into
 * a document with no listener. They now connect under different names (see
 * portRouting.ts) into separate slots, so a reconnect only ever supersedes a
 * port of the same role and the loop is structurally impossible.
 *
 * No filesystem or shell access ever happens here; that boundary lives
 * entirely in the local agent (architecture doc section 52).
 */

import { PortDirectory } from "./portRouting";

// Chrome clamps alarms to at most once every 30 seconds; a shorter period is
// silently dropped with a warning, so 0.5 is the fastest interval that exists.
chrome.alarms.create("devbridge-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  // no-op — wakes the worker so it can re-adopt live ports.
});

/** tabId + role → the live DevTools port. See portRouting.ts for the relay. */
const directory = new PortDirectory();

/** Commands the panel is allowed to push down to a content script. */
const PANEL_TO_CONTENT = new Set([
  "devbridge:set-inspecting",
  "devbridge:locate-element",
  "devbridge:preview-css",
  "devbridge:revert-preview",
  "devbridge:get-page-info",
  "devbridge:locate-devids",
]);

/** Messages a content script may send up to the panel/devtools relay. */
const CONTENT_TO_PANEL = new Set([
  "devbridge:element-selected",
  "devbridge:inspecting-changed",
  "devbridge:page-info",
  "devbridge:locate-result",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Panel / devtools page → background → content script
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  const { previousSameRole, parsed } = directory.connect(port);
  if (!parsed) return; // not one of ours

  // A same-role reconnect (e.g. the panel reloading) supersedes its
  // predecessor. A port of the OTHER role is never touched (audit C1).
  if (previousSameRole) {
    try {
      previousSameRole.disconnect();
    } catch {
      /* already gone */
    }
  }

  // A selection made while the panel was closed is still waiting — deliver it
  // now that someone is listening.
  if (parsed.role === "panel") {
    const pending = directory.takePendingSelection(parsed.tabId);
    if (pending) {
      try {
        port.postMessage(pending);
      } catch {
        directory.rememberSelection(parsed.tabId, pending);
      }
    }
  }

  port.onDisconnect.addListener(() => {
    directory.onDisconnect(port);
    // The panel is the only document that starts inspection. When its port
    // goes away (panel closed, DevTools closed, reload) the content script
    // would otherwise keep swallowing every click with nobody listening
    // (audit C3) — so inspection stops with the panel, best-effort.
    if (parsed.role === "panel") {
      void forwardToContentScript(parsed.tabId, {
        type: "devbridge:set-inspecting",
        value: false,
      });
    }
  });

  port.onMessage.addListener((message) => {
    if (!message || !PANEL_TO_CONTENT.has(message.type)) return;
    void forwardToContentScript(parsed.tabId, message);
  });
});

// A closed tab keeps no relay state behind (audit X1).
chrome.tabs.onRemoved.addListener((tabId) => {
  directory.onTabRemoved(tabId);
});

async function forwardToContentScript(tabId: number, message: { type: string } & Record<string, unknown>): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No content script on this tab (wrong origin, page not yet idle, or the
    // service worker was restarted). Tell whoever is listening so the panel
    // can say something useful instead of appearing to hang.
    const target = directory.panelFor(tabId) ?? directory.devtoolsFor(tabId);
    try {
      target?.postMessage({
        type: "devbridge:no-content-script",
        command: message.type,
      });
    } catch {
      // Port died between the lookup and the post — best effort.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content script → background → panel (preferred) or devtools page (fallback)
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || !CONTENT_TO_PANEL.has(message.type)) {
    return false;
  }

  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return false;

  const relay = {
    ...message,
    tabId,
  };

  if (message.type === "devbridge:element-selected") {
    directory.rememberSelection(tabId, {
      type: "devbridge:element-selected",
      devId: message.devId ?? null,
      tabId,
    });
  }

  try {
    directory.targetForSelection(tabId)?.postMessage(relay);
  } catch {
    // Port died between the lookup and the post — the selection stays in the
    // pending buffer and is delivered on the next panel connect.
  }

  // Nothing is returned to the content script; it does not await a response.
  return false;
});

// This file imports portRouting, so it is a module and its scope never merges
// with devtools.ts (which declares its own copy of the prefixes).
export {};
