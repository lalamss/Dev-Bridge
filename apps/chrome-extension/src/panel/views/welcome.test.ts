import { describe, expect, it } from "vitest";
import { C, S } from "../theme";
import {
  WELCOME_CTA_LABEL,
  WELCOME_STOP_LABEL,
  WELCOME_TAGLINE,
  WELCOME_WORDMARK_BRIDGE,
  WELCOME_WORDMARK_DEV,
  inspectingCtaLabel,
  isInspectCtaDisabled,
  shouldShowWelcome,
} from "./welcome";

/**
 * Centered welcome-screen coverage.
 *
 * Pins the task acceptance rules without needing a DOM:
 *   - exact copy (wordmark parts, tagline, single primary action);
 *   - welcome shows only on the true empty state and returns after clear;
 *   - the Inspect action reuses the existing workflow gating (port
 *     connectivity) and never reports success when unavailable;
 *   - the composition is centered within the panel content area, uses
 *     Arial, scales at narrow widths, and keeps a navy-to-black vector
 *     backdrop (no screenshot background, no viewport-level positioning).
 */

describe("welcome copy", () => {
  it("uses the DevBridge wordmark parts and tagline", () => {
    expect(`${WELCOME_WORDMARK_DEV}${WELCOME_WORDMARK_BRIDGE}`).toBe("DevBridge");
    expect(WELCOME_TAGLINE).toBe("Browser to Source, Seamlessly");
  });

  it("offers exactly one restrained primary action: Inspect a page", () => {
    expect(WELCOME_CTA_LABEL).toBe("Inspect a page");
    expect(WELCOME_STOP_LABEL).toBe("Stop inspecting");
    expect(inspectingCtaLabel(false)).toBe("Inspect a page");
    expect(inspectingCtaLabel(true)).toBe("Stop inspecting");
  });
});

describe("welcome visibility (selection lifecycle)", () => {
  it("shows on the default inspection state (nothing selected)", () => {
    expect(shouldShowWelcome(null, null)).toBe(true);
  });

  it("hides once a real selection arrives (devId or tag)", () => {
    expect(shouldShowWelcome("dev-1", null)).toBe(false);
    expect(shouldShowWelcome(null, "div")).toBe(false);
    expect(shouldShowWelcome("dev-1", "div")).toBe(false);
  });

  it("returns after the user clears the selection", () => {
    // Mirrors App.resetSelection(null, null) — the Clear action.
    const devId: string | null = null;
    const selectedTag: string | null = null;
    expect(shouldShowWelcome(devId, selectedTag)).toBe(true);
  });
});

describe("welcome inspection action gating", () => {
  it("stays disabled without the background-worker port (honest error state)", () => {
    expect(isInspectCtaDisabled(false)).toBe(true);
  });

  it("enables once the panel port is connected", () => {
    expect(isInspectCtaDisabled(true)).toBe(false);
  });
});

describe("welcome centering + responsive composition", () => {
  it("centers the logo group within the panel content area (not the viewport)", () => {
    const welcome = S.welcome as Record<string, unknown>;
    expect(welcome.display).toBe("flex");
    expect(welcome.alignItems).toBe("center");
    expect(welcome.justifyContent).toBe("center");
    // Fills the remaining panel content area below header + conn strip.
    expect(welcome.flex).toBe("1 1 auto");
    // Must not escape the panel: no viewport sizing or fixed positioning.
    expect(String((welcome as { position?: string }).position ?? "")).not.toBe("fixed");
    expect(String(welcome.height ?? "")).not.toContain("100vh");
    expect(String(welcome.width ?? "")).not.toContain("100vw");
  });

  it("keeps the icon above the wordmark and tagline as one centered unit", () => {
    const group = S.welcomeGroup as Record<string, unknown>;
    expect(group.display).toBe("flex");
    expect(group.alignItems).toBe("center");
    expect(group.justifyContent).toBe("center");
    expect(group.margin).toBe("0 auto");
  });

  it("scales down gracefully in narrow DevTools panels", () => {
    const group = S.welcomeGroup as { width?: string };
    expect(String(group.width ?? "")).toContain("100%");
    const wordmark = S.welcomeWordmark as { fontSize?: string };
    // Fluid type instead of a fixed pixel size that would clip.
    expect(String(wordmark.fontSize ?? "")).toContain("clamp");
    const welcome = S.welcome as { overflowY?: string };
    expect(welcome.overflowY).toBe("auto");
  });

  it("uses Arial for the wordmark and welcome text", () => {
    for (const key of ["welcomeWordmark", "welcomeTagline", "welcomeCta", "welcomeHint"] as const) {
      const style = S[key] as { fontFamily?: string };
      expect(String(style.fontFamily ?? "")).toMatch(/arial/i);
    }
  });

  it("renders Dev in off-white and Bridge in a violet-to-blue accent", () => {
    const dev = S.welcomeWordmarkDev as { color?: string };
    expect(String(dev.color ?? "").toLowerCase()).toBe("#f3f4f6");
    const bridge = S.welcomeWordmarkBridge as { background?: string; color?: string };
    const bg = String(bridge.background ?? "").toLowerCase();
    expect(bg).toContain("linear-gradient");
    expect(bg).toContain("a78bfa");
    expect(bg).toContain("60a5fa");
    // Fallback solid accent for non-clip text rendering.
    expect(String(bridge.color ?? "").toLowerCase()).toBe(C.accent.toLowerCase());
  });

  it("uses a deep navy-to-black gradient backdrop (no screenshot background)", () => {
    const welcome = S.welcome as { background?: string };
    const bg = String(welcome.background ?? "").toLowerCase();
    expect(bg).toContain("gradient");
    expect(bg).toContain("#0b1120");
    expect(bg).toMatch(/#04060c|#05070d|black/);
    expect(bg).not.toContain(".png");
    expect(bg).not.toContain(".jpg");
    expect(bg).not.toContain("url(");
  });
});
