/**
 * Navigation model + capability matrix for the DevBridge panel.
 *
 * Pure logic (no chrome/React imports) so it is unit-testable in Node:
 *   - VIEW_ORDER/VIEWS: the four rail destinations. Every entry names a
 *     real view — no decorative destinations.
 *   - capabilityState(): for the four Inspect capability cards, decides
 *     whether each action is available and, when it is not, the honest
 *     reason shown in the UI. No card ever reports success without a
 *     selection and a connected project.
 */

export type PanelView = "inspect" | "components" | "files" | "settings";
export type EditorTab = "editor" | "diff" | "applied";

export const VIEW_ORDER: PanelView[] = ["inspect", "components", "files", "settings"];

export const VIEWS: Record<PanelView, { label: string; hint: string }> = {
  inspect: { label: "Inspect", hint: "Select an element and map it to source" },
  components: { label: "Components", hint: "Browse instrumented component identities" },
  files: { label: "Files", hint: "Browse project source files" },
  settings: { label: "Settings", hint: "Connection, project, and preferences" },
};

export type ConnectionKind = "no-agent" | "unknown-page" | "uninstrumented" | "mismatch" | "connected";

/**
 * Canonical loopback origin for dev-server matching.
 *
 * The build plugin always reports `http://127.0.0.1:<port>`, but developers
 * open either `localhost` or `127.0.0.1` — same server, different string.
 * Comparing raw origins would report a spurious mismatch, so both sides are
 * normalized to the 127.0.0.1 form (ports preserved, unparseable input
 * returned unchanged for the caller to handle).
 */
export function normalizeLoopbackOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.hostname.toLowerCase() === "localhost") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return origin;
  }
}

export interface CapabilityContext {
  connection: ConnectionKind;
  hasSelection: boolean;
  hasIdentity: boolean;
  busy: boolean;
  locating: boolean;
}

export type CapabilityId = "locate" | "open-editor" | "highlight" | "edit-apply";

export interface Capability {
  id: CapabilityId;
  title: string;
  description: string;
  /** Null when available; otherwise the exact reason shown in the UI. */
  unavailableReason: string | null;
}

const NEED_SELECTION = "Select an element on the page first.";
const NEED_CONNECTED = "Available on a connected project — inspect an element on the dev server.";
const NEED_IDENTITY = "No source identity for this element — select an instrumented element.";

export function capabilityState(ctx: CapabilityContext): Capability[] {
  const { connection, hasSelection, hasIdentity, busy, locating } = ctx;
  const connected = connection === "connected";

  const locateReason = !hasSelection
    ? NEED_SELECTION
    : !connected || !hasIdentity
      ? NEED_CONNECTED
      : locating
        ? "Searching the page for live instances…"
        : null;

  const openReason = !hasSelection
    ? NEED_SELECTION
    : !hasIdentity
      ? NEED_IDENTITY
      : !connected
        ? NEED_CONNECTED
        : busy
          ? "Working…"
          : null;

  const highlightReason = !hasSelection
    ? NEED_SELECTION
    : null;

  const editReason = !hasSelection
    ? NEED_SELECTION
    : !hasIdentity
      ? NEED_IDENTITY
      : !connected
        ? NEED_CONNECTED
        : null;

  return [
    {
      id: "locate",
      title: "Locate in Browser",
      description: "Return to and highlight the selected live DOM element.",
      unavailableReason: locateReason,
    },
    {
      id: "open-editor",
      title: "Open in VS Code",
      description: "Open the mapped source file at the correct line and column.",
      unavailableReason: openReason,
    },
    {
      id: "highlight",
      title: "Highlight Instances",
      description: "Find and highlight matching live instances on the page.",
      unavailableReason: highlightReason,
    },
    {
      id: "edit-apply",
      title: "Edit & Apply",
      description: "Edit source, review the diff, and apply with HMR.",
      unavailableReason: editReason,
    },
  ];
}
