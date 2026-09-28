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
 */

let overlayEl: HTMLDivElement | null = null;
let labelEl: HTMLDivElement | null = null;
let inspecting = false;

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

/** Walk up the DOM to find the nearest ancestor (or self) carrying a Dev Identity. */
function nearestDevElement(el: Element | null): HTMLElement | null {
  let cur = el as HTMLElement | null;
  while (cur) {
    if (cur.dataset?.devId) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function positionOverlay(el: HTMLElement): void {
  if (!overlayEl || !labelEl) return;
  const rect = el.getBoundingClientRect();
  overlayEl.style.display = "block";
  overlayEl.style.left = `${rect.left}px`;
  overlayEl.style.top = `${rect.top}px`;
  overlayEl.style.width = `${rect.width}px`;
  overlayEl.style.height = `${rect.height}px`;

  labelEl.style.display = "block";
  labelEl.style.left = `${rect.left}px`;
  labelEl.style.top = `${Math.max(0, rect.top - 20)}px`;
  labelEl.textContent = el.dataset.devId ?? "";
}

function hideOverlay(): void {
  if (overlayEl) overlayEl.style.display = "none";
  if (labelEl) labelEl.style.display = "none";
}

function onMouseMove(e: MouseEvent): void {
  if (!inspecting) return;
  const target = nearestDevElement(e.target as Element);
  if (target) positionOverlay(target);
  else hideOverlay();
}

function onClick(e: MouseEvent): void {
  if (!inspecting) return;
  e.preventDefault();
  e.stopPropagation();
  const target = nearestDevElement(e.target as Element);
  if (!target) return;
  chrome.runtime.sendMessage({
    type: "devbridge:element-selected",
    devId: target.dataset.devId,
  });
}

function setInspecting(value: boolean): void {
  inspecting = value;
  ensureOverlay();
  if (!value) hideOverlay();
}

/** Source -> DOM (section 11): scroll to and flash the element for a given Dev ID. */
function locateElement(devId: string): void {
  const el = document.querySelector<HTMLElement>(`[data-dev-id="${CSS.escape(devId)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  ensureOverlay();
  positionOverlay(el);
  setTimeout(hideOverlay, 1500);
}

window.addEventListener("mousemove", onMouseMove, true);
window.addEventListener("click", onClick, true);

chrome.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "devbridge:set-inspecting":
      setInspecting(Boolean(message.value));
      break;
    case "devbridge:locate-element":
      locateElement(message.devId);
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

// Extend the existing message listener
chrome.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "devbridge:preview-css":
      injectCSSPreview(message.content ?? "");
      break;
    case "devbridge:revert-preview":
      removeCSSPreview();
      break;
  }
});
