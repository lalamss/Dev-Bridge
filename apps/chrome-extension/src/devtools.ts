/**
 * devtools.html's script — registers the "DevBridge" panel in Chrome DevTools
 * (architecture doc section 8: "DevTools Page").
 *
 * This document runs in its own window, separate from the panel's document,
 * so the port it opens is NOT reachable from panel.html — that is fine. The
 * background worker keys ports by tab id, and the panel opens a port with the
 * same name when its React app boots. This page's port exists so the relay is
 * already live (content-script selections are buffered through to whoever is
 * listening) before the user opens the DevBridge tab, and it transparently
 * takes over again if the panel is closed.
 */

const PANEL_PORT_PREFIX = "devbridge-panel-";

const tabId = chrome.devtools.inspectedWindow.tabId;

/** Reconnect delay (ms). The worker is idle-suspended aggressively in MV3. */
const RECONNECT_DELAY = 500;

let port: chrome.runtime.Port | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  port = chrome.runtime.connect({ name: `${PANEL_PORT_PREFIX}${tabId}` });

  port.onDisconnect.addListener(() => {
    port = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, RECONNECT_DELAY);
  });
}

connect();

// The worker can be torn down while DevTools stays open; on every inspected
// page navigation we make sure a port is live again.
chrome.devtools.network.onNavigated.addListener(() => {
  if (!port) {
    if (retryTimer) clearTimeout(retryTimer);
    connect();
  }
});

chrome.devtools.panels.create("DevBridge", "icons/icon48.png", "panel.html", () => {
  // Panel created. panel.html boots src/panel/index.tsx, which opens its own
  // port with the same name to receive element-selected events.
});

// Marks this as a module so its top-level consts stay out of the global
// scope shared with background.ts. See the note in background.ts.
export {};
