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

/**
 * Upper bound on tracked devIds (audit A2). One hostile socket reporting a
 * fresh devId per frame would otherwise grow this map without bound; the
 * oldest entry is evicted instead. 5000 distinct live elements is far beyond
 * any real page, so eviction only ever bites attackers.
 */
const MAX_DEVIDS = 5000;

export class StateStore {
  // devId → ordered list of snapshots, newest last
  private snapshots = new Map<string, StateSnapshot[]>();

  ingest(snapshot: StateSnapshot): void {
    let list = this.snapshots.get(snapshot.devId);
    if (!list) {
      list = [];
      this.snapshots.set(snapshot.devId, list);
      // Maps iterate in insertion order: evict the oldest devId first. The
      // just-added entry is always newest, so it can never evict itself.
      if (this.snapshots.size > MAX_DEVIDS) {
        const oldest = this.snapshots.keys().next();
        if (!oldest.done) this.snapshots.delete(oldest.value);
      }
    } else {
      // Refresh recency so live elements are evicted last.
      this.snapshots.delete(snapshot.devId);
      this.snapshots.set(snapshot.devId, list);
    }
    list.push(snapshot);
    if (list.length > MAX_HISTORY) list.shift();
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

  /** Number of tracked devIds (bounded by MAX_DEVIDS). */
  get size(): number {
    return this.snapshots.size;
  }

  clearAll(): void {
    this.snapshots.clear();
  }
}
