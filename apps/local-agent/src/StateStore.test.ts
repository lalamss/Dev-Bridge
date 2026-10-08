import { describe, expect, it } from "vitest";
import { StateStore } from "./StateStore";

/**
 * Regression coverage for audit A2 (unbounded StateStore growth) —
 * Batch 3 §3. Per-devId history was already capped at 50; the number of
 * devIds was not, so one socket reporting a fresh devId per frame grew the
 * map forever. The store now evicts the oldest devId past 5000.
 */

function snap(devId: string) {
  return { devId, props: {}, state: {}, context: {}, timestamp: new Date().toISOString() };
}

describe("StateStore", () => {
  it("keeps the latest snapshot and bounded history per devId", () => {
    const store = new StateStore();
    for (let i = 0; i < 60; i++) store.ingest(snap("dvi_a"));
    expect(store.history("dvi_a")).toHaveLength(50);
    expect(store.latest("dvi_a")).toBeDefined();
    expect(store.latest("dvi_missing")).toBeUndefined();
  });

  it("evicts the oldest devId past the cap instead of growing forever", () => {
    const store = new StateStore();
    for (let i = 0; i < 5100; i++) store.ingest(snap(`dvi_${i}`));
    expect(store.size).toBeLessThanOrEqual(5000);
    // The first hundred were evicted; recent ones survive.
    expect(store.latest("dvi_0")).toBeUndefined();
    expect(store.latest("dvi_5099")).toBeDefined();
  });

  it("re-ingesting a live devId refreshes its recency", () => {
    const store = new StateStore();
    for (let i = 0; i < 4999; i++) store.ingest(snap(`dvi_${i}`));
    store.ingest(snap("dvi_keepalive"));
    for (let i = 5000; i < 5100; i++) store.ingest(snap(`dvi_${i}`));
    // dvi_0 falls off, but the refreshed live id survives.
    expect(store.latest("dvi_0")).toBeUndefined();
    expect(store.latest("dvi_keepalive")).toBeDefined();
  });
});
