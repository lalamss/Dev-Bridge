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
 * The devtools page opens the port as soon as DevTools is open, so the relay
 * is already live before the user even opens the DevBridge tab. The panel
 * opens its own port with the SAME name; the background keeps the most recent
 * one in its `panels` map, so opening/closing the panel UI never tears down
 * the relay (the devtools page reconnects if the panel's port goes away).
 *
 * The port name carries the tab id — `devbridge-panel-{tabId}` — so a single
 * background worker can serve many inspected tabs at once.
 *
 * No filesystem or shell access ever happens here; that boundary lives
 * entirely in the local agent (architecture doc section 52).
 */

/** Port name prefix; the suffix is always the inspected tab id. */
const PANEL_PORT_PREFIX = "devbridge-panel-";
/** tabId → the live DevTools port for that tab. */
const panels = new Map<number, chrome.runtime.Port>();

/** Commands the panel is allowed to push down to a content script. */
const PANEL_TO_CONTENT = new Set([
  "devbridge:set-inspecting",
  "devbridge:locate-element",
  "devbridge:preview-css",
  "devbridge:revert-preview",
]);

function parseTabId(portName: string): number | null {
  if (!portName.startsWith(PANEL_PORT_PREFIX)) return null;
  const tabId = Number(portName.slice(PANEL_PORT_PREFIX.length));
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel → background → content script
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  const tabId = parseTabId(port.name);
  if (tabId === null) return; // not one of ours

  // A newer port for this tab (e.g. the panel UI opening) supersedes the
  // devtools page's fallback port, so drop the stale one.
  const previous = panels.get(tabId);
  if (previous && previous !== port) {
    try {
      previous.disconnect();
    } catch {
      /* already gone */
    }
  }
  panels.set(tabId, port);

  port.onDisconnect.addListener(() => {
    // Guard against clobbering a newer port that already took this slot.
    if (panels.get(tabId) === port) panels.delete(tabId);
  });

  port.onMessage.addListener((message) => {
    if (!message || !PANEL_TO_CONTENT.has(message.type)) return;
    void forwardToContentScript(tabId, message);
  });
});

async function forwardToContentScript(tabId: number, message: { type: string } & Record<string, unknown>): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No content script on this tab (wrong origin, page not yet idle, or the
    // service worker was restarted). Tell the panel so it can say something
    // useful instead of appearing to hang.
    panels.get(tabId)?.postMessage({
      type: "devbridge:no-content-script",
      command: message.type,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content script → background → panel
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "devbridge:element-selected") return false;

  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return false;

  try {
    panels.get(tabId)?.postMessage({
      type: "devbridge:element-selected",
      devId: message.devId,
      tabId,
    });
  } catch {
    // Port died between the map lookup and the post — best effort.
  }

  // Nothing is returned to the content script; it does not await a response.
  return false;
});

// This file is a Rollup entry with no imports of its own, so without an
// explicit marker TypeScript treats it as a global script and merges its
// scope with devtools.ts (both declare PANEL_PORT_PREFIX).
export {};
