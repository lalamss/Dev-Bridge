/**
 * Port routing for the background service worker (audit C1).
 *
 * Root cause of the ~50% selection loss: the DevTools page and the panel
 * opened ports with the SAME name (`devbridge-panel-{tabId}`) into a
 * single-slot `panels` map, and the worker disconnected whichever port was
 * already there. Both documents reconnect 500 ms after a disconnect, so they
 * evicted each other at ~2 Hz forever — and the DevTools page never
 * registered `onMessage`, so every selection delivered while it held the
 * slot vanished without a trace.
 *
 * Fix: the two documents connect under DIFFERENT names
 * (`devbridge-devtools-{tabId}` vs `devbridge-panel-{tabId}`) into separate
 * slots. A reconnect only ever supersedes a port of the SAME role, so the
 * loop is structurally impossible. Selections go to the panel when it is
 * open; otherwise they are buffered and handed to the panel when it
 * connects, so opening the panel after clicking still shows the element.
 *
 * This module is pure (no `chrome.*` references) so the arbitration can be
 * regression-tested in Node; `background.ts` is the thin adapter that wires
 * real ports into it.
 */

export type PortRole = "devtools" | "panel";

export const DEVTOOLS_PORT_PREFIX = "devbridge-devtools-";
export const PANEL_PORT_PREFIX = "devbridge-panel-";

/** The minimal surface of `chrome.runtime.Port` this directory needs. */
export interface PortLike {
  readonly name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
}

export interface ParsedPortName {
  role: PortRole;
  tabId: number;
}

/** `devbridge-panel-12` → `{ role: "panel", tabId: 12 }`, else null. */
export function parsePortName(name: string): ParsedPortName | null {
  for (const [prefix, role] of [
    [DEVTOOLS_PORT_PREFIX, "devtools"],
    [PANEL_PORT_PREFIX, "panel"],
  ] as const) {
    if (name.startsWith(prefix)) {
      const tabId = Number(name.slice(prefix.length));
      if (Number.isInteger(tabId) && tabId >= 0) return { role, tabId };
    }
  }
  return null;
}

export interface ElementSelectedMessage {
  type: "devbridge:element-selected";
  devId: string | null;
  tabId: number;
}

export class PortDirectory {
  private readonly ports = new Map<string, PortLike>();
  private readonly pendingSelections = new Map<number, ElementSelectedMessage>();

  private key(role: PortRole, tabId: number): string {
    return `${role}:${tabId}`;
  }

  /**
   * Register a newly connected port. Returns the previous port of the same
   * role when a same-document reconnect supersedes it (the caller should
   * disconnect it); a port of the OTHER role is never touched.
   */
  connect(port: PortLike): { previousSameRole: PortLike | null; parsed: ParsedPortName | null } {
    const parsed = parsePortName(port.name);
    if (!parsed) return { previousSameRole: null, parsed: null };
    const key = this.key(parsed.role, parsed.tabId);
    const previousSameRole = this.ports.get(key) ?? null;
    this.ports.set(key, port);
    return { previousSameRole: previousSameRole === port ? null : previousSameRole, parsed };
  }

  /** Forget a disconnected port — but only if it still holds its slot. */
  onDisconnect(port: PortLike): void {
    const parsed = parsePortName(port.name);
    if (!parsed) return;
    const key = this.key(parsed.role, parsed.tabId);
    if (this.ports.get(key) === port) this.ports.delete(key);
  }

  /** Drop all slots for a closed tab (audit X1). */
  onTabRemoved(tabId: number): void {
    this.ports.delete(this.key("devtools", tabId));
    this.ports.delete(this.key("panel", tabId));
    this.pendingSelections.delete(tabId);
  }

  panelFor(tabId: number): PortLike | undefined {
    return this.ports.get(this.key("panel", tabId));
  }

  devtoolsFor(tabId: number): PortLike | undefined {
    return this.ports.get(this.key("devtools", tabId));
  }

  /**
   * Where should an element selection go? The panel when it is listening;
   * otherwise the DevTools page keeps a live relay even with the panel
   * closed — and the selection is buffered so a panel opened afterwards
   * still receives it.
   */
  targetForSelection(tabId: number): PortLike | undefined {
    return this.panelFor(tabId) ?? this.devtoolsFor(tabId);
  }

  rememberSelection(tabId: number, message: ElementSelectedMessage): void {
    this.pendingSelections.set(tabId, message);
  }

  takePendingSelection(tabId: number): ElementSelectedMessage | undefined {
    const pending = this.pendingSelections.get(tabId);
    if (pending) this.pendingSelections.delete(tabId);
    return pending;
  }
}
