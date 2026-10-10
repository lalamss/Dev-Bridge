import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, memoryPrefsStore, sanitize } from "./preferences";

/**
 * Preferences coverage: every toggle in Settings persists through a safe
 * mechanism (chrome.storage.local w/ memory fallback) and drives real
 * behavior in App.tsx. These tests pin defaults, sanitization of stored
 * values, and round-trip persistence via the in-memory seam.
 */

describe("panel preferences", () => {
  it("defaults keep live CSS preview on and auto-locate off", () => {
    expect(DEFAULT_PREFERENCES).toEqual({ autoLocateOnSelect: false, autoPreviewCss: true });
  });

  it("sanitize coerces arbitrary stored values to booleans", () => {
    expect(sanitize({})).toEqual(DEFAULT_PREFERENCES);
    // autoPreviewCss defaults to true: only an explicit false disables it.
    expect(sanitize({ autoLocateOnSelect: "yes" as any, autoPreviewCss: 0 as any })).toEqual({
      autoLocateOnSelect: false,
      autoPreviewCss: true,
    });
    expect(sanitize({ autoLocateOnSelect: true, autoPreviewCss: false })).toEqual({
      autoLocateOnSelect: true,
      autoPreviewCss: false,
    });
  });

  it("round-trips through the in-memory store", async () => {
    const store = memoryPrefsStore();
    expect(await store.load()).toEqual(DEFAULT_PREFERENCES);
    await store.save({ autoLocateOnSelect: true, autoPreviewCss: false });
    expect(store.current).toEqual({ autoLocateOnSelect: true, autoPreviewCss: false });
    expect(await store.load()).toEqual({ autoLocateOnSelect: true, autoPreviewCss: false });
  });
});
