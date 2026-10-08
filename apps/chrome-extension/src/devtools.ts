/**
 * devtools.html's script — registers the "DevBridge" panel in Chrome DevTools
 * (architecture doc section 8: "DevTools Page").
 *
 * This document runs in its own window, separate from the panel's document,
 * so the port it opens is NOT reachable from panel.html — that is fine. It
 * connects under the `devtools` role (see portRouting.ts) while the panel
 * connects under the `panel` role; the background worker keeps one slot per
 * role, so the two documents never evict each other (audit C1). Selections
 * go to the panel when it is open; this port only receives them while the
 * panel is closed, in which case they are also buffered by the worker and
 * replayed to the panel when it connects.
 */

import { DEVTOOLS_PORT_PREFIX } from "./portRouting";

const tabId = chrome.devtools.inspectedWindow.tabId;

/** Reconnect delay (ms). The worker is idle-suspended aggressively in MV3. */
const RECONNECT_DELAY = 500;

let port: chrome.runtime.Port | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  port = chrome.runtime.connect({ name: `${DEVTOOLS_PORT_PREFIX}${tabId}` });

  // The worker only routes selections here while the panel is closed. There
  // is no UI in this document to show them — but the listener must exist:
  // without it a selection delivered to this port vanishes silently (audit
  // C1), and its presence documents that this port is a live relay fallback,
  // not a dead end.
  port.onMessage.addListener((message) => {
    if (message?.type === "devbridge:element-selected") {
      console.debug(
        "[DevBridge] element selected while the panel is closed; buffered for panel open:",
        message.devId,
      );
    }
  });

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
  // port (role `panel`) to receive element-selected events.
});
