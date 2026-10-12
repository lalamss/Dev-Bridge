import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hover-system coverage for the DevBridge panel.
 *
 * Root cause this pins: React inline styles outrank stylesheet :hover rules,
 * so any background/border/color set inline silently kills the hover state.
 * Interactive colors therefore live ONLY in panel.html (.db-* classes) while
 * the theme tokens in theme.ts carry layout and typography. These tests read
 * the shipped stylesheet and component sources directly:
 *   - theme tokens set no contested inline props on interactive elements;
 *   - one canonical rule per control/state (no dead duplicates, no hacks);
 *   - real background/border/color transitions on the actual elements;
 *   - static logo stays affordance-free; active states stay distinct;
 *   - short transitions, reduced-motion support, extension-scoped selectors;
 *   - real inspection/selection wiring untouched.
 */

const here = dirname(fileURLToPath(import.meta.url));
const panelHtml = readFileSync(join(here, "panel.html"), "utf8");
const styleBlock = panelHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
const themeSrc = readFileSync(join(here, "theme.ts"), "utf8");
const appSrc = readFileSync(join(here, "App.tsx"), "utf8");
const landingSrc = readFileSync(join(here, "views", "InspectLanding.tsx"), "utf8");
const railSrc = readFileSync(join(here, "components", "NavRail.tsx"), "utf8");
const headerSrc = readFileSync(join(here, "components", "Header.tsx"), "utf8");
const filesSrc = readFileSync(join(here, "views", "FilesView.tsx"), "utf8");
const componentsSrc = readFileSync(join(here, "views", "ComponentsView.tsx"), "utf8");
const contentScriptSrc = readFileSync(join(here, "..", "content-script.ts"), "utf8");

function tokenBody(key: string): string {
  return new RegExp(`${key}:\\s*\\{([^}]*)\\}`).exec(themeSrc)?.[1] ?? "";
}

function hasContestedInlineProps(key: string): boolean {
  const body = tokenBody(key);
  return (
    /\bbackground\s*:/.test(body) ||
    /\bborder(?!Radius)[A-Za-z]*\s*:/.test(body) ||
    /\bcolor\s*:/.test(body)
  );
}

describe("root cause guard: no inline styles fighting the stylesheet", () => {
  it("keeps background/border/color off interactive theme tokens", () => {
    for (const key of ["railBtn", "tab", "row", "disclosureSummary", "btn"]) {
      expect(hasContestedInlineProps(key), `S.${key} must not set contested props`).toBe(false);
    }
  });

  it("keeps state-variant tokens free of competing visuals", () => {
    for (const key of ["railBtnActive", "tabActive", "rowActive", "btnPrimary", "btnCyan", "btnDanger"]) {
      expect(hasContestedInlineProps(key), `S.${key} must not set contested props`).toBe(false);
    }
  });

  it("lets CSS :disabled own button dimming (no inline opacity overrides)", () => {
    expect(appSrc).not.toMatch(/opacity/);
  });
});

describe("canonical hover rules (no duplicates, no hacks)", () => {
  it("defines exactly one :hover rule per control", () => {
    // Reduced-motion guards live inside @media and are not hover definitions.
    // Patterns anchor on the opening brace so descendant rules (e.g. label
    // underline reveals like `.db-tab:hover… .db-tab-label::after`) don't
    // inflate the count — one canonical feedback rule per control.
    const baseRules = styleBlock.replace(/@media[^{]*\{([\s\S]*?)\}\s*\}/g, "");
    for (const selector of [
      "\\.db-btn:hover:not\\(:disabled\\)\\s*\\{",
      "\\.db-btn-primary:hover:not\\(:disabled\\)\\s*\\{",
      "\\.db-btn-cyan:hover:not\\(:disabled\\)\\s*\\{",
      "\\.db-welcome-cta:hover:not\\(:disabled\\)\\s*\\{",
      "\\.db-rail-btn:not\\(\\.db-rail-btn-active\\):hover\\s*\\{",
      "\\.db-tab:hover:not\\(:disabled\\)\\s*\\{",
      "\\.db-row:hover\\s*\\{",
      "\\.db-summary:hover\\s*\\{",
    ]) {
      const count = [...baseRules.matchAll(new RegExp(selector, "g"))].length;
      expect(count, `${selector} must appear exactly once`).toBe(1);
    }
  });

  it("uses real stylesheet properties instead of filter workarounds", () => {
    expect(styleBlock).not.toMatch(/brightness\(/);
    expect(styleBlock).not.toMatch(/inset 0 0 0 999px/);
    expect(styleBlock).not.toMatch(/drop-shadow/);
    expect(styleBlock).toMatch(/transition:[^;]*background-color/);
  });
});

describe("Inspect a page button", () => {
  it("brightens to violet with a subtle shadow and 2px lift on hover", () => {
    const rule = styleBlock.match(/\.db-welcome-cta:hover[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/background:\s*#7c6cf0/);
    expect(rule).toMatch(/box-shadow:\s*0 4px 18px/);
    expect(rule).toMatch(/translateY\(-2px\)/);
  });

  it("provides distinct pressed, keyboard-focus, and disabled states", () => {
    const active = styleBlock.match(/\.db-welcome-cta:active[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(active).toMatch(/translateY\(0\)/);
    expect(active).toMatch(/background:\s*#5a4cd4/);
    expect(styleBlock).toMatch(/\.db-welcome-cta:focus-visible\s*\{[^}]*outline/);
    expect(styleBlock).toMatch(/\.db-welcome-cta:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    expect(styleBlock).toMatch(/\.db-welcome-cta:disabled\s*\{[^}]*opacity:\s*0\.5/);
  });

  it("still invokes the real inspection workflow with honest gating", () => {
    expect(landingSrc).toMatch(/onClick=\{onToggleInspect\}/);
    expect(landingSrc).toMatch(/disabled=\{ctaDisabled\}/);
  });
});

describe("static welcome logo (non-interactive)", () => {
  it("applies no hover transform, glow, or pointer affordance", () => {
    expect(styleBlock).not.toMatch(/\.db-welcome-logo/);
    expect(styleBlock).not.toMatch(/scale\(1\.02\)/);
    expect(landingSrc).not.toMatch(/onClick=\{[^}]*\}.*DevBridgeMark|DevBridgeMark.*onClick/);
    expect(landingSrc).toMatch(/aria-label="DevBridge"/);
  });
});

describe("sidebar navigation", () => {
  it("tints and brightens inactive items on hover via real properties", () => {
    const rule = styleBlock.match(/\.db-rail-btn:not\([^)]*\)\:hover\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/background:\s*#1e2129/);
    expect(rule).toMatch(/color:\s*#e4e4e7/);
  });

  it("keeps the active item distinct with its violet indicator", () => {
    const active = styleBlock.match(/\.db-rail-btn-active\s*\{[^}]*\}/)?.[0] ?? "";
    expect(active).toMatch(/border-left-color:\s*#9d8cff/);
    expect(active).toMatch(/background:\s*#1e2129/);
    expect(railSrc).toMatch(/db-rail-btn-active/);
  });

  it("changes the view on click only — never on hover", () => {
    expect(railSrc).toMatch(/onClick=\{\(\) => onNavigate\(id\)\}/);
    expect(railSrc).not.toMatch(/onMouseEnter|onMouseOver|onHover/);
    expect(railSrc).toMatch(/aria-current/);
  });
});

describe("header controls and inspection actions", () => {
  it("gives header buttons real background/border hover, press, and focus states", () => {
    const hover = styleBlock.match(/\.db-btn:hover[^{]*\{[^}]*\}/)?.[0] ?? "";
    expect(hover).toMatch(/background:\s*#2a2e38/);
    expect(hover).toMatch(/border-color:\s*#3f3f46/);
    expect(styleBlock).toMatch(/\.db-btn:active[^{]*\{[^}]*background:\s*#23262f/);
    expect(headerSrc).toMatch(/onClick=\{onRefresh\}/);
    expect(headerSrc).toMatch(/onClick=\{onOpenSettings\}/);
  });

  it("covers accent variants, tabs, rows, and summaries consistently", () => {
    expect(styleBlock).toMatch(/\.db-btn-primary:hover[^{]*\{[^}]*background:\s*#7c6cf0/);
    expect(styleBlock).toMatch(/\.db-btn-cyan:hover[^{]*\{[^}]*border-color:\s*#67e8f9/);
    expect(styleBlock).toMatch(/\.db-tab:hover[^{]*\{[^}]*color:\s*#e4e4e7/);
    expect(styleBlock).toMatch(/\.db-tab-active\s*\{[^}]*border-bottom-color:\s*#9d8cff/);
    expect(styleBlock).toMatch(/\.db-row:hover\s*\{[^}]*background:\s*#1e2129/);
    expect(styleBlock).toMatch(/\.db-summary:hover\s*\{[^}]*color:\s*#e4e4e7/);
    expect(appSrc).toMatch(/db-tab-active/);
    expect(filesSrc).toMatch(/db-row-active/);
    expect(componentsSrc).toMatch(/db-row-active/);
    // The Files "Open in VS Code" action spreads the cyan token, so it must
    // carry the cyan class — otherwise the cyan :hover rule never fires.
    expect(filesSrc).toMatch(/db-btn db-btn-cyan/);
  });
});

describe("animated text underline (text-width, left-to-right)", () => {
  it("wraps rail, tab, and header labels in dedicated underline spans", () => {
    expect(railSrc).toMatch(/db-rail-label/);
    expect(appSrc).toMatch(/db-tab-label/);
    expect(headerSrc).toMatch(/db-btn-label/);
  });

  it("draws a thin violet-blue line sized to the text via ::after + scaleX", () => {
    for (const label of ["db-rail-label", "db-tab-label", "db-btn-label"]) {
      expect(styleBlock).toMatch(new RegExp(`\\.${label}::after[^}]*height:\\s*1px`));
      expect(styleBlock).toMatch(new RegExp(`\\.${label}::after[^}]*linear-gradient\\(90deg,\\s*#a78bfa[^)]*#60a5fa`));
      expect(styleBlock).toMatch(new RegExp(`\\.${label}::after[^}]*transform:\\s*scaleX\\(0\\)`));
      expect(styleBlock).toMatch(new RegExp(`\\.${label}::after[^}]*transform-origin:\\s*left`));
      expect(styleBlock).toMatch(new RegExp(`\\.${label}::after[^}]*transition:\\s*transform\\s*0\\.20s`));
    }
  });

  it("reveals the underline on hover and keyboard focus without layout shift", () => {
    for (const selector of [
      ".db-rail-btn:not(.db-rail-btn-active):hover .db-rail-label::after",
      ".db-rail-btn:focus-visible .db-rail-label::after",
      ".db-tab:hover:not(:disabled) .db-tab-label::after",
      ".db-tab:focus-visible .db-tab-label::after",
      ".db-btn:hover:not(:disabled) .db-btn-label::after",
      ".db-btn:focus-visible .db-btn-label::after",
    ]) {
      expect(styleBlock).toContain(selector);
    }
    const afterRules = styleBlock.match(/\.(db-rail-label|db-tab-label|db-btn-label)::after\s*\{[^}]*\}/g) ?? [];
    for (const rule of afterRules) {
      expect(rule).not.toMatch(/width|margin|padding/);
    }
  });

  it("keeps the active rail item persistently indicated and never underlines plain text", () => {
    expect(styleBlock).toMatch(/\.db-rail-btn-active\s+\.db-rail-label::after\s*\{[^}]*scaleX\(1\)/);
    // The only text-underline reveals target the three interactive label
    // classes — headings and descriptions carry no label class.
    const underlineOwners = [...styleBlock.matchAll(/\.([\w-]+)::after\s*\{[^}]*scaleX/g)].map((m) => m[1]);
    expect(underlineOwners.length).toBeGreaterThan(0);
    for (const owner of underlineOwners) {
      expect(["db-rail-label", "db-tab-label", "db-btn-label"]).toContain(owner);
    }
    expect(landingSrc).not.toMatch(/db-rail-label|db-tab-label|db-btn-label/);
  });
});

describe("cursor effects", () => {
  it("uses pointer on clickable controls, text in inputs, and not-allowed when disabled", () => {
    expect(styleBlock).toMatch(/\.db-btn:not\(:disabled\)[^{]*\{[^}]*cursor:\s*pointer/);
    expect(styleBlock).toMatch(/\.db-search\s*\{[^}]*cursor:\s*text/);
    expect(styleBlock).toMatch(/\.db-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    expect(styleBlock).toMatch(/\.db-tab:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });

  it("never replaces the cursor globally or with oversized decoration", () => {
    expect(styleBlock).not.toMatch(/\*\s*\{[^}]*cursor/);
    expect(styleBlock).not.toMatch(/cursor:\s*url\(/);
    expect(styleBlock).not.toMatch(/@keyframes/);
  });

  it("shows a crosshair picker cursor while inspecting and restores it after", () => {
    expect(contentScriptSrc).toMatch(/crosshair/);
    expect(contentScriptSrc).toMatch(/devbridge-inspecting/);
    expect(contentScriptSrc).toMatch(/setInspectCursor\(value\)/);
    expect(contentScriptSrc).toMatch(/classList\.remove\(INSPECT_CURSOR_CLASS\)/);
    // Editable fields keep the text cursor even during inspection.
    expect(contentScriptSrc).toMatch(/contenteditable.*cursor:\s*text|text.*contenteditable/s);
    expect(contentScriptSrc).toMatch(/pagehide/);
  });
});

describe("motion and accessibility", () => {
  it("keeps every transition short (150–200 ms)", () => {
    const durations = [...styleBlock.matchAll(/transition:[^;]*?0\.(\d+)s/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(15);
      expect(d).toBeLessThanOrEqual(20);
    }
    expect(styleBlock).not.toMatch(/@keyframes/);
    expect(styleBlock).not.toMatch(/animation\s*:/);
  });

  it("respects prefers-reduced-motion by disabling transitions and the lift", () => {
    const reduced = styleBlock.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? "";
    expect(reduced).toContain("transition: none");
    expect(reduced).toMatch(/transform:\s*none/);
  });

  it("scopes hover styling to the DevBridge extension UI", () => {
    const cssNoComments = styleBlock.replace(/\/\*[\s\S]*?\*\//g, "");
    const hoverSelectors = [...cssNoComments.matchAll(/([.][^{};]+:hover[^{};]*)\{/g)].map((m) => m[1].trim());
    expect(hoverSelectors.length).toBeGreaterThan(0);
    for (const selector of hoverSelectors) {
      for (const part of selector.split(",")) {
        expect(part.trim()).toMatch(/^\.db-/);
      }
    }
  });
});
