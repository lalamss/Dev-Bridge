import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INFLUENCE_RADIUS_PX,
  MAX_POINTS,
  POINT_CLOUD_CLASS,
  POINT_SPACING_PX,
  approachValue,
  pointCountForArea,
  prefersReducedMotion,
} from "./PointCloudCanvas";

/**
 * Point-cloud coverage (node runtime: pure helpers + source-shape guards).
 *
 * Pins the decorative-only contract without needing WebGL:
 *   - grid density scales with area and never exceeds the cap;
 *   - easing steps converge monotonically (inertia without snapping);
 *   - the canvas stays behind content, non-interactive, cursor-free, and
 *     scoped to DevBridge's own panel — never the inspected website;
 *   - resize/DPR/visibility/context-loss/reduced-motion handling exists;
 *   - the welcome screen keeps its content above the canvas.
 */

const here = dirname(fileURLToPath(import.meta.url));
const panelDir = join(here, "..");
const panelHtml = readFileSync(join(panelDir, "panel.html"), "utf8");
const styleBlock = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const componentSrc = readFileSync(join(here, "PointCloudCanvas.tsx"), "utf8");
const landingSrc = readFileSync(join(panelDir, "views", "InspectLanding.tsx"), "utf8");
const themeSrc = readFileSync(join(panelDir, "theme.ts"), "utf8");

describe("grid density (pure)", () => {
  it("returns zero for empty or invalid areas", () => {
    expect(pointCountForArea(0, 300)).toBe(0);
    expect(pointCountForArea(400, 0)).toBe(0);
    expect(pointCountForArea(-10, 300)).toBe(0);
    expect(pointCountForArea(NaN, 300)).toBe(0);
  });

  it("scales with panel area at the configured spacing", () => {
    const small = pointCountForArea(200, 150);
    const large = pointCountForArea(400, 300);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(small).toBe(
      Math.floor(200 / POINT_SPACING_PX) * Math.floor(150 / POINT_SPACING_PX),
    );
  });

  it("never exceeds the hard cap on huge panels", () => {
    expect(pointCountForArea(4000, 3000)).toBeLessThanOrEqual(MAX_POINTS);
    expect(pointCountForArea(4000, 3000)).toBe(MAX_POINTS);
  });
});

describe("inertia easing (pure)", () => {
  it("converges monotonically toward the target without overshoot", () => {
    let v = 0;
    for (let i = 0; i < 200; i += 1) {
      const next = approachValue(v, 100, 0.14);
      expect(next).toBeGreaterThanOrEqual(v);
      expect(next).toBeLessThanOrEqual(100);
      v = next;
    }
    expect(v).toBeGreaterThan(99.9);
  });

  it("ignores non-positive factors instead of snapping", () => {
    expect(approachValue(10, 100, 0)).toBe(10);
    expect(approachValue(10, 100, -1)).toBe(10);
  });

  it("treats reduced-motion as opt-in only and never throws outside a DOM", () => {
    expect(typeof prefersReducedMotion()).toBe("boolean");
  });
});

describe("decorative-only contract", () => {
  it("renders behind the welcome content and never intercepts input", () => {
    const rule = styleBlock.match(/\.db-point-cloud\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    expect(rule).not.toMatch(/cursor/);
    expect(rule).not.toMatch(/:hover/);
    expect(POINT_CLOUD_CLASS).toBe("db-point-cloud");
  });

  it("mounts inside the welcome surface with content layered above", () => {
    expect(landingSrc).toMatch(/<PointCloudCanvas \/>/);
    expect(themeSrc).toMatch(/position:\s*"relative"/);
    expect(themeSrc).toMatch(/zIndex:\s*1/);
  });

  it("never touches cursors or the inspected website", () => {
    expect(componentSrc).not.toMatch(/style\.cursor\s*=/);
    expect(componentSrc).not.toMatch(/\.cursor\s*=/);
    expect(componentSrc).not.toMatch(/cursor:\s*url\(/);
    expect(componentSrc).not.toMatch(/content-script|inspectedWindow|executeScript/);
  });

  it("keeps the palette restrained and the field readable", () => {
    expect(componentSrc).toMatch(/0\.42, 0\.36, 0\.94/);
    expect(styleBlock).toMatch(/\.db-point-cloud\s*\{[^}]*opacity:\s*0\.55/);
    expect(styleBlock).not.toMatch(/\.db-point-cloud[^{]*:hover/);
  });
});

describe("lifecycle and efficiency", () => {
  it("tracks pointer + velocity, pauses offscreen, and cleans up", () => {
    expect(componentSrc).toMatch(/pointermove/);
    expect(componentSrc).toMatch(/pointerleave/);
    expect(componentSrc).toMatch(/u_mouseVel/);
    expect(componentSrc).toMatch(/visibilitychange/);
    expect(componentSrc).toMatch(/cancelAnimationFrame/);
    expect(componentSrc).toMatch(/ResizeObserver/);
    expect(componentSrc).toMatch(/devicePixelRatio/);
  });

  it("handles context loss and missing WebGL gracefully", () => {
    expect(componentSrc).toMatch(/webglcontextlost/);
    expect(componentSrc).toMatch(/webglcontextrestored/);
    expect(componentSrc).toMatch(/display.*none/);
  });

  it("respects prefers-reduced-motion with a static frame", () => {
    expect(componentSrc).toMatch(/prefers-reduced-motion/);
    expect(componentSrc).toMatch(/INFLUENCE_RADIUS_PX|150/);
    expect(INFLUENCE_RADIUS_PX).toBe(150);
  });
});
