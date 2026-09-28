/**
 * StateStore — in-memory store for Props/State/Context snapshots.
 *
 * Keeps the last MAX_HISTORY snapshots per devId so the panel can show
 * both the current values and a lightweight render history.
 *
 * This is intentionally a plain class (not a Map wrapper) so it can be
 * injected into routes and tested independently of the agent HTTP layer.
 */

import type { StateSnapshot } from "@devbridge/protocol";

const MAX_HISTORY = 50; // per devId

export class StateStore {
  // devId → ordered list of snapshots, newest last
  private snapshots = new Map<string, StateSnapshot[]>();

  ingest(snapshot: StateSnapshot): void {
    const list = this.snapshots.get(snapshot.devId) ?? [];
    list.push(snapshot);
    if (list.length > MAX_HISTORY) list.shift();
    this.snapshots.set(snapshot.devId, list);
  }

  /** Latest snapshot for a devId, or undefined if none received yet. */
  latest(devId: string): StateSnapshot | undefined {
    const list = this.snapshots.get(devId);
    return list ? list[list.length - 1] : undefined;
  }

  /** All snapshots for a devId, newest first. */
  history(devId: string): StateSnapshot[] {
    return [...(this.snapshots.get(devId) ?? [])].reverse();
  }

  clear(devId: string): void {
    this.snapshots.delete(devId);
  }

  clearAll(): void {
    this.snapshots.clear();
  }
}
