/**
 * Content Script — architecture doc section 8-11.
 *
 * Responsibilities (doc section 8):
 *   DOM selection, hover, overlay, Dev ID, events, responsive preview,
 *   a11y highlighting.
 *
 * This runs in the page's context (isolated world) on localhost dev servers
 * only (see manifest.json host_permissions) — it never runs on arbitrary
 * production sites.
 *
 * Inspection lifecycle (audit C3):
 *   panel "Start inspecting" ─▶ set-inspecting true ─▶ hover highlights,
 *   click selects AND stops inspection (auto-stop), Escape cancels, panel
 *   ✕ / panel-port disconnect stops it remotely. Every local transition is
 *   echoed as `devbridge:inspecting-changed` so the panel always reflects
 *   the real controller state instead of its own button state.
 *
 * PACKAGING CONSTRAINT (audit X8): this entry must build to a classic
 * script — no top-level import/export may survive in dist/content-script.js.
 * `inspectionLogic.ts` is therefore imported only here (never from another
 * entry) so Rollup inlines it instead of emitting a shared chunk.
 */

import {
  clickSelection,
  hoverFor,
  overlayLabel,
} from "./inspectionLogic";

// The worker can inject this script twice for the same document (e.g.
// navigation races); event listeners must be registered exactly once or
// every click sends duplicate selections.
if (!(window as any).__devbridgeContentScriptLoaded) {
  (window as any).__devbridgeContentScriptLoaded = true;
  boot();
}

function boot(): void {
  let overlayEl: HTMLDivElement | null = null;
  let labelEl: HTMLDivElement | null = null;
  let inspecting = false;
  /** Auto-hide timer for Source→DOM flashes; never hides live hover (P11). */
  let locateTimer: ReturnType<typeof setTimeout> | undefined;

  function ensureOverlay(): void {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647;
    border: 2px solid #7c3aed; background: rgba(124, 58, 237, 0.08);
    display: none; transition: all 60ms ease-out;
  `;
    labelEl = document.createElement("div");
    labelEl.style.cssText = `
    position: fixed; pointer-events: none; z-index: 2147483647;
    background: #7c3aed; color: white; font: 11px monospace;
    padding: 2px 6px; border-radius: 3px; display: none;
  `;
    document.documentElement.appendChild(overlayEl);
    document.documentElement.appendChild(labelEl);
  }

  function positionOverlay(el: HTMLElement, devId: string | null): void {
    if (!overlayEl || !labelEl) return;
    // getBoundingClientRect is viewport-relative and the overlay is fixed, so
    // no scroll math is needed — but the box goes stale on scroll/resize, and
    // those listeners hide it until the next pointer move (see below).
    const rect = el.getBoundingClientRect();
    overlayEl.style.display = "block";
    overlayEl.style.left = `${rect.left}px`;
    overlayEl.style.top = `${rect.top}px`;
    overlayEl.style.width = `${rect.width}px`;
    overlayEl.style.height = `${rect.height}px`;

    labelEl.style.display = "block";
    labelEl.style.left = `${rect.left}px`;
    labelEl.style.top = `${Math.max(0, rect.top - 20)}px`;
    labelEl.textContent = overlayLabel(devId);
  }

  function hideOverlay(): void {
    if (overlayEl) overlayEl.style.display = "none";
    if (labelEl) labelEl.style.display = "none";
  }

  function notifyInspectingChanged(value: boolean): void {
    try {
      chrome.runtime.sendMessage({ type: "devbridge:inspecting-changed", value });
    } catch {
      // Worker unreachable (restarting) — the panel resyncs on reconnect.
    }
  }

  function setInspecting(value: boolean, notify: boolean): void {
    if (inspecting === value) {
      // Still resync the panel: after a worker restart it may have lost the
      // state and need the current intent pushed again.
      if (notify) notifyInspectingChanged(value);
      return;
    }
    inspecting = value;
    ensureOverlay();
    if (locateTimer) {
      clearTimeout(locateTimer);
      locateTimer = undefined;
    }
    if (!value) hideOverlay();
    if (notify) notifyInspectingChanged(value);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!inspecting) return;
    // The overlay is pointer-events:none, so e.target is always the real
    // element beneath the cursor — no coordinate math, no obstruction.
    const target = e.target as Element | null;
    if (!target || typeof (target as HTMLElement).getBoundingClientRect !== "function") {
      hideOverlay();
      return;
    }
    const hover = hoverFor(target as any);
    if (!hover) {
      hideOverlay();
      return;
    }
    positionOverlay(hover.box as HTMLElement, hover.devId);
  }

  function onClick(e: MouseEvent): void {
    if (!inspecting) return;
    const selection = clickSelection(inspecting, (e.target as Element) as any);
    if (!selection) return;
    // Consumed: the page's own handler must not fire for an inspection click.
    e.preventDefault();
    e.stopPropagation();
    try {
      chrome.runtime.sendMessage(selection);
    } catch {
      // Worker unreachable — stop anyway so the page never stays hijacked.
    }
    // Auto-stop after a consumed click (success or no-identity alike): the
    // alternative is every later click being swallowed with no way back.
    setInspecting(false, true);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!inspecting) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setInspecting(false, true);
    }
  }

  function onScrollOrResize(): void {
    // The fixed overlay's box is only valid at event time; hide it until the
    // next pointer move repositions it rather than showing a stale box.
    if (inspecting) hideOverlay();
  }

  /** Source -> DOM (section 11): scroll to and flash the element for a Dev ID. */
  function locateElement(devId: string): void {
    let el: HTMLElement | null = null;
    try {
      el = document.querySelector<HTMLElement>(`[data-dev-id="${CSS.escape(devId)}"]`);
    } catch {
      return;
    }
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    ensureOverlay();
    positionOverlay(el, devId);
    if (locateTimer) clearTimeout(locateTimer);
    // A locate flash must never hide the live hover overlay (audit P11).
    locateTimer = setTimeout(() => {
      if (!inspecting) hideOverlay();
      locateTimer = undefined;
    }, 1500);
  }

  // Capture phase so inspection sees the event before page handlers — and
  // stopPropagation in onClick keeps a consumed click from reaching them.
  window.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
  window.addEventListener("resize", onScrollOrResize);
  // Navigation/reload destroys this world; bfcache restore keeps it with a
  // hidden overlay so no stale box survives the trip.
  window.addEventListener("pagehide", hideOverlay);

  // ONE listener for every message (audit X3): the previous two independent
  // onMessage registrations ran every message through both switches.
  chrome.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "devbridge:set-inspecting":
        setInspecting(Boolean(message.value), false);
        break;
      case "devbridge:locate-element":
        if (typeof message.devId === "string") locateElement(message.devId);
        break;
      case "devbridge:preview-css":
        injectCSSPreview(message.content ?? "");
        break;
      case "devbridge:revert-preview":
        removeCSSPreview();
        break;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Visual preview (CSS hotswap) — section 15 / feature #10
  //
  // When the panel creates a CSS patch it sends the new CSS content here.
  // We inject a <style> tag so the developer sees the change live in the
  // running app *before* approving it. On reject we remove the tag.
  // ─────────────────────────────────────────────────────────────

  const PREVIEW_TAG_ID = "devbridge-css-preview";

  function injectCSSPreview(content: string): void {
    let tag = document.getElementById(PREVIEW_TAG_ID) as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = PREVIEW_TAG_ID;
      document.head.appendChild(tag);
    }
    tag.textContent = content;
  }

  function removeCSSPreview(): void {
    document.getElementById(PREVIEW_TAG_ID)?.remove();
  }
}
