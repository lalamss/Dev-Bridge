/**
 * Pure inspection logic for the content script (audit C3, C4, P11).
 *
 * The content script must stay a classic script (no ESM syntax in
 * `dist/content-script.js` — see audit X8), so this module has no imports and
 * is bundled inline by the extension build. It is deliberately DOM-agnostic:
 * elements are structural (`dataset`, `parentElement`, `tagName`) so every
 * decision below is unit-testable in Node without jsdom.
 *
 * Decisions pinned here:
 * - Hover shows the overlay for ANY element under the cursor. When nothing
 *   on the ancestor chain carries a DevBridge identity the overlay still
 *   appears, labelled "no DevBridge identity", instead of hiding (audit rec
 *   15). An invisible hover state is indistinguishable from a broken one.
 * - Clicks are only intercepted while inspecting, and inspection always ends
 *   on click (success or not) or on Escape. The old code intercepted every
 *   click forever after one selection with no way back except the panel ✕.
 * - Selection payloads distinguish "DOM node with identity" (`devId`) from
 *   "DOM node without one" (`devId: null` + tag name). The panel must never
 *   fabricate a source location for the second case (audit C4).
 */

export interface InspectorElement {
  readonly tagName: string;
  readonly dataset?: { devId?: string } | null;
  readonly parentElement: InspectorElement | null;
}

export interface HoverTarget {
  /** The element to draw the box around (nearest identity, else raw hover). */
  readonly box: InspectorElement;
  /** Identity when the hovered element (or an ancestor) carries one. */
  readonly devId: string | null;
}

export interface SelectedPayload {
  type: "devbridge:element-selected";
  devId: string | null;
  /** Tag name, present only when devId is null (no identity to resolve). */
  tag?: string;
}

/** Walk up the ancestor chain for the nearest element carrying a Dev Identity. */
export function nearestDevElement(
  el: InspectorElement | null,
): InspectorElement | null {
  let cur = el;
  while (cur) {
    if (cur.dataset?.devId) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * What should the hover overlay show for the element under the cursor?
 * Null when the cursor is not over an element at all.
 */
export function hoverFor(target: InspectorElement | null): HoverTarget | null {
  if (!target) return null;
  const dev = nearestDevElement(target);
  if (dev) return { box: dev, devId: dev.dataset!.devId! };
  return { box: target, devId: null };
}

/** Label text for the overlay: the identity, or an honest disclaimer. */
export function overlayLabel(devId: string | null): string {
  return devId ?? "(no DevBridge identity)";
}

/**
 * What should a click while inspecting do? Returns the selection message to
 * send, or null when inspection is off (the page keeps the click untouched).
 */
export function clickSelection(
  inspecting: boolean,
  target: InspectorElement | null,
): SelectedPayload | null {
  if (!inspecting) return null;
  const dev = nearestDevElement(target);
  if (dev?.dataset?.devId) {
    return { type: "devbridge:element-selected", devId: dev.dataset.devId };
  }
  // Graceful no-identity selection (audit C4): the panel explains that only
  // a DOM node was identified instead of inventing a source location.
  const tag = target?.tagName?.toLowerCase();
  return {
    type: "devbridge:element-selected",
    devId: null,
    ...(tag ? { tag } : {}),
  };
}

/** Inspection always ends when a click is consumed — success or not. */
export function inspectingAfterClick(
  inspecting: boolean,
  consumed: boolean,
): boolean {
  return inspecting && !consumed ? true : false;
}

/** Escape cancels inspection; anything else leaves it unchanged. */
export function inspectingAfterKey(inspecting: boolean, key: string): boolean {
  if (!inspecting) return false;
  return key === "Escape" ? false : true;
}
